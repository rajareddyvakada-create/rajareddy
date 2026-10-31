"""
XM trading bridge: MetaTrader 5 terminal -> FastAPI (REST + WebSocket) -> browser.

Runs on the Windows PC where the MT5 terminal is logged into the XM account. The browser
(phone or laptop on the same WiFi) talks only to this server, never to XM directly.

MT5 notes that shape this file:
  * The `MetaTrader5` package is Windows-only and talks to a *running* terminal over a local
    pipe. It is NOT thread-safe, so every call here happens under one lock.
  * The terminal must have "Algo Trading" enabled or order_send() returns AutoTrading disabled.
  * Times from MT5 are epoch seconds in the *broker's server timezone* (XM is UTC+2/+3), not UTC.
    Candles and ticks are both passed through unchanged so the chart lines up with MT5 itself.
  * Prices: a BUY fills at the ask, a SELL at the bid. Using the wrong side is rejected or slips.

Start with:  uvicorn server:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

import MetaTrader5 as mt5
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

import updater

# ----------------------------------------------------------------------------- configuration

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

MT5_PATH = os.getenv("MT5_PATH", "").strip()
MT5_LOGIN = os.getenv("MT5_LOGIN", "").strip()
MT5_PASSWORD = os.getenv("MT5_PASSWORD", "").strip()
MT5_SERVER = os.getenv("MT5_SERVER", "").strip()
API_KEY = os.getenv("API_KEY", "").strip()
# Where the web page updates itself from. Blank switches updating off entirely.
UPDATE_URL = os.getenv("UPDATE_URL", updater.DEFAULT_URL).strip()

MAGIC = int(os.getenv("MAGIC", "770077"))          # marks orders this app sent
DEVIATION = int(os.getenv("DEVIATION", "20"))      # max slippage in points
MAX_LOT = float(os.getenv("MAX_LOT", "1.0"))       # safety cap, refuses anything bigger
TICK_INTERVAL = float(os.getenv("TICK_INTERVAL", "0.2"))   # websocket push interval, seconds

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s")
log = logging.getLogger("xm-bridge")

# MT5 timeframe strings -> constants. Anything not listed here is rejected.
TIMEFRAMES: dict[str, int] = {
    "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1, "MN1": mt5.TIMEFRAME_MN1,
}

FRONTEND = BASE_DIR / "frontend"

# ----------------------------------------------------------------------------- MT5 plumbing

_LOCK = threading.RLock()        # the MT5 package is not thread-safe: one call at a time
_last_connect_attempt = 0.0
_connected = False
_rest_busy = 0                   # chart and order requests in flight; tick polls stand back for them
_rest_busy_lock = threading.Lock()


_OFFSET_FILE = BASE_DIR / ".server_offset.json"
_server_offset: int | None = None
_server_offset_at = 0.0


def server_utc_offset() -> int | None:
    """
    Seconds the broker's clock runs ahead of UTC (XM is +2 in winter, +3 in summer). Every time MT5
    reports is the server's wall clock, so this is what lets the page show any other timezone.

    It is measured by comparing a live tick with real UTC, which only works while a market is open,
    so the last good value is kept on disk for weekends and restarts. None means never measured.
    """
    global _server_offset, _server_offset_at
    now = time.monotonic()
    if _server_offset is not None and now - _server_offset_at < 900:
        return _server_offset
    if _server_offset is None and _OFFSET_FILE.is_file():
        try:
            _server_offset = int(json.loads(_OFFSET_FILE.read_text())["offset"])
        except Exception:
            pass
    try:
        with _LOCK:
            watch = mt5.symbols_get()
        fresh_tick = None
        for sym in (watch or [])[:40]:
            if not sym.visible:
                continue
            tick = mt5_call(mt5.symbol_info_tick, sym.name)
            # a tick older than a minute is a closed market: its clock says nothing about now
            if tick is not None and tick.time and abs(tick.time - time.time()) < 13 * 3600:
                if fresh_tick is None or tick.time > fresh_tick:
                    fresh_tick = tick.time
        if fresh_tick is not None:
            # timezone offsets come in 15-minute steps; the rounding absorbs tick latency
            offset = int(round((fresh_tick - time.time()) / 900.0) * 900)
            if _server_offset != offset:
                log.info("Broker clock is UTC%+.2g hours", offset / 3600)
            _server_offset = offset
            try:
                _OFFSET_FILE.write_text(json.dumps({"offset": offset}))
            except OSError:
                pass
    except Mt5Error:
        pass
    _server_offset_at = now
    return _server_offset


def max_bars() -> int:
    """How many candles the terminal keeps per chart (Tools - Options - Charts - Max bars)."""
    with _LOCK:
        term = mt5.terminal_info()
    return int(getattr(term, "maxbars", 0)) if term else 0


@contextmanager
def rest_priority():
    """While this is held, the websocket tick loop pauses so it can't queue ahead of a chart load."""
    global _rest_busy
    with _rest_busy_lock:
        _rest_busy += 1
    try:
        yield
    finally:
        with _rest_busy_lock:
            _rest_busy -= 1


class Mt5Error(Exception):
    """An MT5 call failed. Carries the terminal's own error code and message."""

    def __init__(self, what: str, code: int | None = None, detail: str | None = None):
        err = mt5.last_error() if code is None else (code, detail or "")
        self.code, self.detail = int(err[0]), str(err[1])
        self.what = what
        super().__init__(f"{what}: [{self.code}] {self.detail}")


def _initialize_locked() -> None:
    """(Re)connect to the terminal. Caller holds the lock."""
    global _connected
    mt5.shutdown()  # harmless when not initialized; clears a half-dead session
    kwargs: dict[str, Any] = {}
    if MT5_PATH:
        kwargs["path"] = MT5_PATH
    if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
        kwargs.update(login=int(MT5_LOGIN), password=MT5_PASSWORD, server=MT5_SERVER)

    if not mt5.initialize(**kwargs):
        _connected = False
        raise Mt5Error("Couldn't connect to the MT5 terminal")

    acc = mt5.account_info()
    if acc is None:
        _connected = False
        raise Mt5Error("Connected to the terminal but not logged in")

    _connected = True
    term = mt5.terminal_info()
    log.info(
        "MT5 connected: account %s (%s) on %s, balance %.2f %s, algo trading %s",
        acc.login, acc.name, acc.server, acc.balance, acc.currency,
        "ON" if (term and term.trade_allowed) else "OFF — enable it in the terminal",
    )


def ensure_connection() -> None:
    """Connect if needed. Reconnect attempts are throttled so a dead terminal can't be hammered."""
    global _last_connect_attempt
    with _LOCK:
        if _connected and mt5.terminal_info() is not None and mt5.account_info() is not None:
            return
        now = time.monotonic()
        if _connected and now - _last_connect_attempt < 2.0:
            raise Mt5Error("MT5 connection lost, reconnecting")
        _last_connect_attempt = now
        log.warning("MT5 not connected, (re)connecting…")
        _initialize_locked()


def mt5_call(fn, *args, **kwargs):
    """Run one MT5 call with the connection checked and the lock held."""
    ensure_connection()
    with _LOCK:
        return fn(*args, **kwargs)


def select_symbol(symbol: str) -> tuple[Any, bool]:
    """Symbol info, adding it to Market Watch first — MT5 returns nothing for unselected symbols.
    The second value says whether it was added just now, which means its history is still downloading."""
    ensure_connection()
    with _LOCK:
        info = mt5.symbol_info(symbol)
        if info is None:
            raise HTTPException(404, f"Unknown symbol '{symbol}'. Open Market Watch in MT5 to see the exact names this account uses (XM has GOLD, XAUUSD, US30Cash and so on), or use Browse in the app.")
        fresh = not info.visible
        if fresh:
            if not mt5.symbol_select(symbol, True):
                raise Mt5Error(f"Couldn't add {symbol} to Market Watch")
            mt5.symbol_info_tick(symbol)   # nudges the terminal to subscribe and start the download
            info = mt5.symbol_info(symbol)
        return info, fresh


def rates_with_warmup(name: str, tf: int, count: int, fresh: bool, offset: int = 0) -> Any:
    """
    The first request for a symbol MT5 has just subscribed to returns little or nothing while the
    terminal downloads its history. Retry briefly instead of drawing a stub chart. The sleeps are
    outside the lock, so prices keep flowing to anyone watching another symbol.
    """
    deadline = time.monotonic() + (8.0 if fresh else 2.0)
    want = min(count, 120)
    best = None
    while True:
        rates = mt5_call(mt5.copy_rates_from_pos, name, tf, offset, count)
        if rates is not None and len(rates) >= want:
            return rates
        if rates is not None and (best is None or len(rates) > len(best)):
            best = rates
        if time.monotonic() >= deadline:
            return best
        time.sleep(0.25)


def as_dict(obj: Any) -> Any:
    """MT5 results are named tuples; turn them (and anything nested) into plain JSON types."""
    if obj is None:
        return None
    if hasattr(obj, "_asdict"):
        return {k: as_dict(v) for k, v in obj._asdict().items()}
    if isinstance(obj, (list, tuple)):
        return [as_dict(x) for x in obj]
    if isinstance(obj, dict):
        return {k: as_dict(v) for k, v in obj.items()}
    return obj


def filling_mode(info: Any) -> int:
    """
    Pick a filling mode the symbol actually accepts. IOC is the default asked for, but some XM
    symbols only allow FOK, and the wrong one fails with 10030 "Unsupported filling mode".
    info.filling_mode is a bitmask of SYMBOL_FILLING_FOK / SYMBOL_FILLING_IOC.
    """
    allowed = getattr(info, "filling_mode", 0)
    if allowed & 2:        # SYMBOL_FILLING_IOC
        return mt5.ORDER_FILLING_IOC
    if allowed & 1:        # SYMBOL_FILLING_FOK
        return mt5.ORDER_FILLING_FOK
    return mt5.ORDER_FILLING_RETURN


# ----------------------------------------------------------------------------- auth

def require_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    """Every REST endpoint needs the key from .env in an X-API-Key header."""
    if not API_KEY:
        raise HTTPException(500, "API_KEY is not set in .env on the server.")
    if not x_api_key or not hmac.compare_digest(x_api_key, API_KEY):
        raise HTTPException(401, "Missing or wrong X-API-Key.")


# ----------------------------------------------------------------------------- request models

class OrderRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    direction: Literal["buy", "sell"]
    lot: float = Field(gt=0)
    sl: float | None = Field(default=None, ge=0)
    tp: float | None = Field(default=None, ge=0)
    comment: str = Field(default="xm-bridge", max_length=31)

    @field_validator("lot")
    @classmethod
    def lot_within_cap(cls, v: float) -> float:
        if v > MAX_LOT:
            raise ValueError(f"lot {v} is above the MAX_LOT safety cap of {MAX_LOT} set in .env")
        return v


class CloseRequest(BaseModel):
    ticket: int = Field(gt=0)
    lot: float | None = Field(default=None, gt=0)   # omit to close the whole position


# ----------------------------------------------------------------------------- app

app = FastAPI(title="XM MT5 bridge", version="1.0.0")


@app.exception_handler(Mt5Error)
async def mt5_error_handler(_req, exc: Mt5Error):
    """An MT5 failure is a clear JSON error, never a 500 traceback or a dead server."""
    log.error("%s", exc)
    return JSONResponse(status_code=503, content={"error": exc.what, "mt5_code": exc.code, "mt5_message": exc.detail})


@app.on_event("startup")
def startup() -> None:
    for name, value in (("MT5_LOGIN", MT5_LOGIN), ("MT5_PASSWORD", MT5_PASSWORD), ("MT5_SERVER", MT5_SERVER), ("API_KEY", API_KEY)):
        if not value:
            log.warning("%s is empty in .env — see .env.example", name)
    try:
        ensure_connection()
    except Mt5Error as e:        # the server still starts; endpoints retry and report the reason
        log.error("Startup connection failed: %s", e)


@app.on_event("shutdown")
def shutdown() -> None:
    with _LOCK:
        mt5.shutdown()


@app.get("/api/health")
def health() -> dict[str, Any]:
    """No key needed: lets you check the server is up before entering the key."""
    with _LOCK:
        term = mt5.terminal_info()
        acc = mt5.account_info()
    return {
        "server": "ok",
        "mt5_connected": term is not None and acc is not None,
        "algo_trading_enabled": bool(term.trade_allowed) if term else False,
        "login": acc.login if acc else None,
        "broker_server": acc.server if acc else None,
        "server_utc_offset": server_utc_offset() if (term and acc) else None,
        "max_bars": max_bars() if term else 0,
    }


@app.get("/api/update", dependencies=[Depends(require_key)])
def update_check() -> dict[str, Any]:
    """Is the page online different from the one being served?"""
    if not UPDATE_URL:
        return {"enabled": False, "reason": "UPDATE_URL is empty in .env, so updating is switched off."}
    try:
        return dict(enabled=True, **updater.status(FRONTEND / "index.html", UPDATE_URL))
    except updater.UpdateError as e:
        return {"enabled": True, "error": str(e)}


@app.post("/api/update", dependencies=[Depends(require_key)])
def update_apply() -> dict[str, Any]:
    """Replace the page with the one online. The old page is kept as index.html.bak."""
    if not UPDATE_URL:
        raise HTTPException(400, "UPDATE_URL is empty in .env, so updating is switched off.")
    try:
        res = updater.apply(FRONTEND / "index.html", UPDATE_URL)
    except updater.UpdateError as e:
        raise HTTPException(502, str(e))
    if res.get("changed"):
        log.info("Page updated to %s (the old one is index.html.bak)", res.get("current"))
    return res


@app.get("/api/account", dependencies=[Depends(require_key)])
def account() -> dict[str, Any]:
    acc = mt5_call(mt5.account_info)
    if acc is None:
        raise Mt5Error("Couldn't read the account")
    return {
        "login": acc.login, "name": acc.name, "server": acc.server, "currency": acc.currency,
        "balance": acc.balance, "equity": acc.equity, "margin": acc.margin,
        "margin_free": acc.margin_free, "margin_level": acc.margin_level, "profit": acc.profit,
        "leverage": acc.leverage, "trade_allowed": acc.trade_allowed,
    }


@app.get("/api/symbols", dependencies=[Depends(require_key)])
def symbols(all: bool = Query(default=False, description="true = every symbol the broker offers, not just Market Watch"),
            search: str = Query(default="", max_length=32)) -> dict[str, Any]:
    found = mt5_call(mt5.symbols_get)
    if found is None:
        raise Mt5Error("Couldn't list symbols")
    needle = search.strip().upper()
    out = [
        {"name": s.name, "description": s.description, "path": s.path, "digits": s.digits,
         "visible": s.visible, "volume_min": s.volume_min, "volume_max": s.volume_max, "volume_step": s.volume_step}
        for s in found
        if (all or s.visible) and (not needle or needle in s.name.upper() or needle in (s.description or "").upper())
    ]
    out.sort(key=lambda s: s["name"])
    return {"count": len(out), "symbols": out[:500]}


@app.get("/api/candles", dependencies=[Depends(require_key)])
def candles(symbol: str = Query(min_length=1, max_length=32),
            timeframe: str = Query(default="M5"),
            count: int = Query(default=300, ge=1, le=5000),
            offset: int = Query(default=0, ge=0, le=500000,
                                description="how many candles back from now to start, for loading older history")) -> dict[str, Any]:
    """
    OHLC history, newest last. Times are the broker's wall clock as epoch seconds; use
    server_utc_offset to show them in another timezone.
    """
    tf_name = timeframe.strip().upper()
    if tf_name not in TIMEFRAMES:
        raise HTTPException(400, f"Unknown timeframe '{timeframe}'. Use one of: {', '.join(TIMEFRAMES)}")
    started = time.monotonic()
    with rest_priority():
        info, fresh = select_symbol(symbol)
        # copy_rates_from_pos(symbol, timeframe, start_pos, count): 0 = the candle forming right now
        rates = rates_with_warmup(info.name, TIMEFRAMES[tf_name], count, fresh, offset)
    took = (time.monotonic() - started) * 1000
    if rates is None or len(rates) == 0:
        raise Mt5Error(f"No candles for {info.name} {tf_name}. MT5 may still be downloading its history — try again in a moment.")
    if took > 1000:
        log.info("candles %s %s: %d bars in %.0f ms%s", info.name, tf_name, len(rates), took, " (first time for this symbol)" if fresh else "")
    bars = [
        {"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]),
         "low": float(r["low"]), "close": float(r["close"]), "volume": int(r["tick_volume"])}
        for r in rates
    ]
    return {
        "symbol": info.name, "timeframe": tf_name, "digits": info.digits,
        "count": len(bars), "candles": bars,
        "offset": offset,
        "has_more": len(bars) >= count,          # a full batch means older candles are still there
        "max_bars": max_bars(),                  # what the terminal is set to keep per chart
        "server_utc_offset": server_utc_offset(),
    }


@app.post("/api/order", dependencies=[Depends(require_key)])
def place_order(req: OrderRequest) -> dict[str, Any]:
    """Market buy or sell. Returns the terminal's full order_send() result, success or not."""
    info, _ = select_symbol(req.symbol)

    if req.lot < info.volume_min or req.lot > info.volume_max:
        raise HTTPException(400, f"lot must be between {info.volume_min} and {info.volume_max} for {info.name}")
    step = info.volume_step or 0.01
    if abs(round(req.lot / step) * step - req.lot) > 1e-9:
        raise HTTPException(400, f"lot must be a multiple of {step} for {info.name}")

    tick = mt5_call(mt5.symbol_info_tick, info.name)
    if tick is None or not tick.ask or not tick.bid:
        raise Mt5Error(f"No price for {info.name} (market closed?)")

    is_buy = req.direction == "buy"
    price = tick.ask if is_buy else tick.bid          # buy at the ask, sell at the bid
    request: dict[str, Any] = {
        "action": mt5.TRADE_ACTION_DEAL,              # market order, filled now
        "symbol": info.name,
        "volume": float(req.lot),
        "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        "price": price,
        "deviation": DEVIATION,                       # accept this many points of slippage
        "magic": MAGIC,
        "comment": req.comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    # A stop/target on the wrong side is rejected by the server, so check it here with a clear message.
    if req.sl:
        if (is_buy and req.sl >= price) or (not is_buy and req.sl <= price):
            raise HTTPException(400, f"Stop-loss must be {'below' if is_buy else 'above'} the price ({price}).")
        request["sl"] = float(req.sl)
    if req.tp:
        if (is_buy and req.tp <= price) or (not is_buy and req.tp >= price):
            raise HTTPException(400, f"Take-profit must be {'above' if is_buy else 'below'} the price ({price}).")
        request["tp"] = float(req.tp)

    result = mt5_call(mt5.order_send, request)
    if result is None:
        raise Mt5Error("order_send returned nothing")
    out = as_dict(result)
    out["ok"] = result.retcode == mt5.TRADE_RETCODE_DONE
    out["retcode_text"] = RETCODES.get(result.retcode, "see MT5 docs for this return code")
    log.info("ORDER %s %s %.2f -> retcode %s (%s)", req.direction, info.name, req.lot, result.retcode, out["retcode_text"])
    return out


@app.get("/api/positions", dependencies=[Depends(require_key)])
def positions(symbol: str = Query(default="", max_length=32)) -> dict[str, Any]:
    found = mt5_call(mt5.positions_get, symbol=symbol) if symbol else mt5_call(mt5.positions_get)
    if found is None:
        raise Mt5Error("Couldn't read open positions")
    out = []
    for p in found:
        out.append({
            "ticket": p.ticket, "symbol": p.symbol,
            "direction": "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell",
            "volume": p.volume, "price_open": p.price_open, "price_current": p.price_current,
            "sl": p.sl, "tp": p.tp, "profit": p.profit, "swap": p.swap,
            "time": int(p.time), "magic": p.magic, "comment": p.comment,
        })
    return {"count": len(out), "positions": out}


@app.post("/api/close", dependencies=[Depends(require_key)])
def close_position(req: CloseRequest) -> dict[str, Any]:
    """Close a position by ticket: MT5 closes with an opposite deal carrying position=<ticket>."""
    found = mt5_call(mt5.positions_get, ticket=req.ticket)
    if not found:
        raise HTTPException(404, f"No open position with ticket {req.ticket}.")
    pos = found[0]
    info, _ = select_symbol(pos.symbol)
    tick = mt5_call(mt5.symbol_info_tick, pos.symbol)
    if tick is None:
        raise Mt5Error(f"No price for {pos.symbol} (market closed?)")

    was_buy = pos.type == mt5.POSITION_TYPE_BUY
    volume = float(req.lot) if req.lot else float(pos.volume)
    if volume > pos.volume:
        raise HTTPException(400, f"Position {pos.ticket} is only {pos.volume} lots.")

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": volume,
        "type": mt5.ORDER_TYPE_SELL if was_buy else mt5.ORDER_TYPE_BUY,   # opposite side
        "position": pos.ticket,                                            # this is what closes it
        "price": tick.bid if was_buy else tick.ask,
        "deviation": DEVIATION,
        "magic": MAGIC,
        "comment": "xm-bridge close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": filling_mode(info),
    }
    result = mt5_call(mt5.order_send, request)
    if result is None:
        raise Mt5Error("order_send returned nothing")
    out = as_dict(result)
    out["ok"] = result.retcode == mt5.TRADE_RETCODE_DONE
    out["retcode_text"] = RETCODES.get(result.retcode, "see MT5 docs for this return code")
    log.info("CLOSE %s %.2f -> retcode %s (%s)", pos.ticket, volume, result.retcode, out["retcode_text"])
    return out


# The return codes worth explaining in plain words; everything else falls back to the raw number.
RETCODES = {
    10009: "Done",
    10004: "Requote — the price moved, try again",
    10006: "Rejected by the broker",
    10013: "Invalid request",
    10014: "Invalid lot size",
    10015: "Invalid price",
    10016: "Invalid stop-loss or take-profit level",
    10018: "Market is closed",
    10019: "Not enough money",
    10021: "No prices (off-quotes)",
    10027: "Algo Trading is switched off in the terminal — turn it on",
    10030: "Unsupported filling mode for this symbol",
    10031: "No connection between the terminal and the broker",
}


# ----------------------------------------------------------------------------- websocket ticks

@app.websocket("/ws/ticks")
async def ws_ticks(ws: WebSocket, symbol: str = Query(default="EURUSD"), key: str = Query(default="")) -> None:
    """
    Pushes the latest bid/ask about every 200 ms. The browser WebSocket API can't set headers,
    so the API key comes in as ?key=... (same key as X-API-Key).
    """
    supplied = key or ws.headers.get("x-api-key", "")
    if not API_KEY or not supplied or not hmac.compare_digest(supplied, API_KEY):
        await ws.close(code=1008, reason="Missing or wrong API key")
        return
    await ws.accept()

    try:
        info, _ = await asyncio.to_thread(select_symbol, symbol)
    except (HTTPException, Mt5Error) as e:
        await ws.send_json({"error": getattr(e, "detail", str(e))})
        await ws.close(code=1011)
        return

    name, digits = info.name, info.digits
    log.info("WS open: %s", name)
    last_sent: tuple[float, float, int] | None = None
    try:
        while True:
            if _rest_busy:                 # a chart or order is loading: don't queue ahead of it
                await asyncio.sleep(0.3)
                continue
            try:
                tick = await asyncio.to_thread(mt5_call, mt5.symbol_info_tick, name)
            except Mt5Error as e:                      # terminal died: tell the client, keep trying
                await ws.send_json({"symbol": name, "error": str(e)})
                await asyncio.sleep(1.0)
                continue
            if tick is not None:
                current = (tick.bid, tick.ask, int(tick.time))
                await ws.send_json({
                    "symbol": name, "bid": tick.bid, "ask": tick.ask,
                    "last": tick.last, "time": int(tick.time), "digits": digits,
                    "server_utc_offset": server_utc_offset(),
                    "changed": current != last_sent,
                })
                last_sent = current
            await asyncio.sleep(TICK_INTERVAL)
    except WebSocketDisconnect:
        log.info("WS closed: %s", name)
    except Exception as e:                             # never let one client take the server down
        log.exception("WS error on %s: %s", name, e)
        try:
            await ws.close(code=1011)
        except Exception:
            pass


# ----------------------------------------------------------------------------- frontend

if FRONTEND.is_dir():
    @app.get("/")
    def index() -> FileResponse:
        # no-store, so an updated page is never hidden behind the browser's cache
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})

    app.mount("/app", StaticFiles(directory=FRONTEND, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
