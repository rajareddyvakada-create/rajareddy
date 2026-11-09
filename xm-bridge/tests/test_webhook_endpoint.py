"""End-to-end test of POST /webhook/tradingview, with a stub MetaTrader5 module.

webhook.py's own tests cover the parsing and the guards. This one covers the wiring: that the route
exists without an API key, that it reaches the same order code the BUY/SELL buttons use, that the
lot/stop checks in that shared path still apply, that a close only touches this app's own
positions, and that a stranger with no secret is told nothing.

MetaTrader5 only exists on Windows, so a stand-in is put in sys.modules before server.py is
imported. It records what order_send was asked to do, which is what we actually want to assert:
that an alert turns into the right MT5 request.

    pip install fastapi httpx
    python3 test_webhook_endpoint.py
"""
import os
import pathlib
import sys
import types

HERE = pathlib.Path(__file__).resolve().parent
BACKEND = HERE.parent / "backend"

SECRET = "webhook-secret-for-tests"

# The guard reads .env at import time, so the environment is set up first.
os.environ.update({
    "API_KEY": "test-key-123",
    "WEBHOOK_ENABLED": "true",
    "WEBHOOK_SECRET": SECRET,
    "WEBHOOK_MAX_LOT": "0.10",
    "WEBHOOK_DEFAULT_LOT": "0.01",
    "MT5_PATH": "",
})

MAGIC = 770077          # must match the bridge's default MAGIC


# --------------------------------------------------------------------------- the stand-in MT5

class Tick:
    def __init__(self, bid, ask):
        self.bid, self.ask, self.time = bid, ask, 1794117000
        self.last, self.volume = bid, 1


class SymbolInfo:
    def __init__(self, name):
        self.name = name
        self.digits = 2
        self.volume_min, self.volume_max, self.volume_step = 0.01, 50.0, 0.01
        self.visible = True
        self.description = name
        self.path = "FX\\" + name
        self.filling_mode = 1
        self.trade_mode = 4


class Position:
    def __init__(self, ticket, symbol, kind, volume, magic):
        self.ticket, self.symbol, self.type, self.volume, self.magic = ticket, symbol, kind, volume, magic
        self.price_open, self.price_current, self.profit, self.sl, self.tp = 4000.0, 4001.0, 1.0, 0.0, 0.0
        self.time, self.comment = 1794117000, "x"


class Result:
    # MT5 returns named tuples, and server.as_dict() reads them through _asdict(), so the
    # stand-in has to offer the same thing or the real code path is not being tested.
    def __init__(self, retcode, volume=0.0):
        self.retcode, self.volume = retcode, volume
        self.order, self.deal, self.price, self.bid, self.ask = 1, 2, 4000.0, 3999.0, 4000.0
        self.comment, self.request_id, self.retcode_external = "Done", 0, 0

    def _asdict(self):
        return {
            "retcode": self.retcode, "deal": self.deal, "order": self.order,
            "volume": self.volume, "price": self.price, "bid": self.bid, "ask": self.ask,
            "comment": self.comment, "request_id": self.request_id,
            "retcode_external": self.retcode_external,
        }


class Account:
    def __init__(self, trade_mode=0):
        self.login, self.name, self.server, self.currency = 123, "T", "XM-Demo", "USD"
        self.balance = self.equity = 10000.0
        self.margin = self.margin_free = self.margin_level = self.profit = 0.0
        self.leverage, self.trade_allowed, self.trade_mode = 500, True, trade_mode


class Terminal:
    trade_allowed = True
    maxbars = 5000
    path = ""


mt5 = types.ModuleType("MetaTrader5")
mt5.TRADE_ACTION_DEAL = 1
mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_SELL = 0, 1
mt5.POSITION_TYPE_BUY, mt5.POSITION_TYPE_SELL = 0, 1
mt5.ORDER_TIME_GTC = 0
mt5.TRADE_RETCODE_DONE = 10009
mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN = 1, 0, 2
mt5.SYMBOL_FILLING_IOC, mt5.SYMBOL_FILLING_FOK = 2, 1
for _i, _tf in enumerate(("M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1")):
    setattr(mt5, "TIMEFRAME_" + _tf, _i + 1)

STATE = {
    "sent": [],                     # every order_send request, in order
    "positions": [],
    "account": Account(trade_mode=0),
    "fail_next": False,
}

mt5.initialize = lambda *a, **k: True
mt5.shutdown = lambda: None
mt5.last_error = lambda: (0, "ok")
mt5.terminal_info = lambda: Terminal()
mt5.account_info = lambda: STATE["account"]
mt5.symbol_info = lambda name: SymbolInfo(name) if name in ("XAUUSD", "EURUSD", "US30Cash") else None
mt5.symbol_info_tick = lambda name: Tick(3999.0, 4000.0)
mt5.symbol_select = lambda name, on=True: True
mt5.copy_rates_from_pos = lambda *a, **k: []
mt5.symbols_get = lambda *a, **k: [SymbolInfo("XAUUSD"), SymbolInfo("EURUSD")]


def _positions_get(symbol=None, ticket=None):
    out = STATE["positions"]
    if symbol:
        out = [p for p in out if p.symbol == symbol]
    if ticket is not None:
        out = [p for p in out if p.ticket == ticket]
    return tuple(out)


def _order_send(request):
    STATE["sent"].append(dict(request))
    if STATE["fail_next"]:
        STATE["fail_next"] = False
        return Result(10013)                      # "Invalid request"
    closing = request.get("position")
    if closing:
        STATE["positions"] = [p for p in STATE["positions"] if p.ticket != closing]
    return Result(mt5.TRADE_RETCODE_DONE, request.get("volume", 0.0))


mt5.positions_get = _positions_get
mt5.order_send = _order_send
sys.modules["MetaTrader5"] = mt5

sys.path.insert(0, str(BACKEND))
import server                                     # noqa: E402  (must follow the stub above)
from fastapi.testclient import TestClient         # noqa: E402

client = TestClient(server.app)
URL = "/webhook/tradingview"

fails = 0


def ok(name, cond, detail=""):
    global fails
    if not cond:
        fails += 1
    print(("PASS " if cond else "FAIL ") + name + (" — " + str(detail) if detail else ""))


def reset(trade_mode=0, positions=None):
    STATE["sent"].clear()
    STATE["positions"] = list(positions or [])
    STATE["account"] = Account(trade_mode=trade_mode)
    STATE["fail_next"] = False
    # a fresh guard, so one test's duplicate bookkeeping cannot refuse the next test's alert
    server.WEBHOOK = server.webhook.guard_from_env(os.environ.get)


def post(body, **kw):
    return client.post(URL, content=body, **kw)


print("--- the endpoint takes an alert and sends the order")
reset()
r = post(f"{SECRET},buy,XAUUSD,0.02")
ok("A plain alert is accepted", r.status_code == 200 and r.json()["ok"], f"{r.status_code} {r.text[:90]}")
sent = STATE["sent"][-1] if STATE["sent"] else {}
ok("It became a market BUY on the right symbol",
   sent.get("symbol") == "XAUUSD" and sent.get("type") == mt5.ORDER_TYPE_BUY
   and sent.get("volume") == 0.02 and sent.get("action") == mt5.TRADE_ACTION_DEAL, sent)
ok("It is tagged with this app's magic number", sent.get("magic") == MAGIC, sent.get("magic"))
ok("A buy is filled at the ask", sent.get("price") == 4000.0, sent.get("price"))

reset()
r = post('{"secret":"%s","action":"sell","symbol":"EURUSD","lot":0.05}' % SECRET)
sent = STATE["sent"][-1]
ok("A JSON alert sells at the bid",
   r.status_code == 200 and sent["type"] == mt5.ORDER_TYPE_SELL and sent["price"] == 3999.0,
   f"{r.status_code} {sent.get('price')}")

reset()
r = post(f"{SECRET},buy,XAUUSD,0.02,sl=3990,tp=4010")
sent = STATE["sent"][-1]
ok("A stop and target are passed through", sent.get("sl") == 3990.0 and sent.get("tp") == 4010.0, sent)

print("--- no API key is needed here, but the secret is")
reset()
r = post("wrong-secret,buy,XAUUSD,0.01")
ok("A wrong secret is refused", r.status_code == 401, r.status_code)
ok("Nothing was sent to MT5", not STATE["sent"], STATE["sent"])
ok("The reply gives a prober nothing", r.json().get("error") == "refused", r.text[:80])

reset()
r = post("hello")
ok("Junk is refused", r.status_code == 400, f"{r.status_code} {r.text[:80]}")
ok("Junk sent nothing to MT5", not STATE["sent"])

reset()
r = client.post(URL, content=f"{SECRET},buy,XAUUSD,0.01", headers={"X-API-Key": "wrong"})
ok("A wrong X-API-Key does not matter on this endpoint", r.status_code == 200, r.status_code)

print("--- the shared order path still does its checks")
reset()
r = post(f"{SECRET},buy,XAUUSD,0.015")
ok("A lot off the broker's step is refused", r.status_code == 400 and "multiple" in r.text,
   f"{r.status_code} {r.text[:90]}")

reset()
r = post(f"{SECRET},buy,XAUUSD,0.02,sl=4100")
ok("A stop on the wrong side of the price is refused",
   r.status_code == 400 and "Stop-loss" in r.text, f"{r.status_code} {r.text[:90]}")

reset()
r = post(f"{SECRET},buy,NOSUCH,0.02")
ok("An unknown symbol is refused with advice", r.status_code == 404 and "Market Watch" in r.text,
   f"{r.status_code} {r.text[:90]}")

reset()
r = post(f"{SECRET},buy,XAUUSD,0.5")
ok("A lot above the webhook cap is refused", r.status_code == 400 and "cap" in r.text,
   f"{r.status_code} {r.text[:90]}")
ok("The oversized alert never reached MT5", not STATE["sent"])

print("--- a rejected order is reported, not swallowed")
reset()
STATE["fail_next"] = True
r = post(f"{SECRET},buy,XAUUSD,0.02")
ok("MT5 refusing the deal is a 502 with the reason",
   r.status_code == 502 and r.json()["ok"] is False
   and "Invalid request" in str(r.json()["result"].get("retcode_text", "")),
   f"{r.status_code} {str(r.json().get('result', {}).get('retcode_text'))[:50]}")

print("--- closing")
reset(positions=[
    Position(1, "XAUUSD", mt5.POSITION_TYPE_BUY, 0.02, MAGIC),
    Position(2, "XAUUSD", mt5.POSITION_TYPE_SELL, 0.01, MAGIC),
    Position(3, "XAUUSD", mt5.POSITION_TYPE_BUY, 0.05, 999),      # placed by hand in the terminal
    Position(4, "EURUSD", mt5.POSITION_TYPE_BUY, 0.01, MAGIC),
])
r = post(f"{SECRET},close,XAUUSD")
closed = {s.get("position") for s in STATE["sent"]}
ok("close shuts both sides on that symbol", r.status_code == 200 and {1, 2} <= closed,
   f"{r.status_code} {sorted(closed)}")
ok("It leaves a hand-placed position alone", 3 not in closed, sorted(closed))
ok("It leaves other symbols alone", 4 not in closed, sorted(closed))

reset(positions=[
    Position(1, "XAUUSD", mt5.POSITION_TYPE_BUY, 0.02, MAGIC),
    Position(2, "XAUUSD", mt5.POSITION_TYPE_SELL, 0.01, MAGIC),
])
r = post(f"{SECRET},closelong,XAUUSD")
closed = {s.get("position") for s in STATE["sent"]}
ok("closelong shuts only the buy", r.status_code == 200 and closed == {1}, sorted(closed))

reset(positions=[
    Position(1, "XAUUSD", mt5.POSITION_TYPE_BUY, 0.02, MAGIC),
    Position(4, "EURUSD", mt5.POSITION_TYPE_BUY, 0.01, MAGIC),
    Position(5, "EURUSD", mt5.POSITION_TYPE_BUY, 0.01, 999),
])
r = post(f"{SECRET},closeall")
closed = {s.get("position") for s in STATE["sent"]}
ok("closeall shuts this app's positions on every symbol",
   r.status_code == 200 and closed == {1, 4}, sorted(closed))

reset()
r = post(f"{SECRET},close,XAUUSD")
ok("Closing with nothing open is not an error", r.status_code == 200 and r.json()["ok"],
   f"{r.status_code} {r.text[:80]}")

print("--- a live account")
reset(trade_mode=2)
r = post(f"{SECRET},buy,XAUUSD,0.02")
ok("A live account is refused by default", r.status_code == 403, f"{r.status_code} {r.text[:90]}")
ok("Nothing reached MT5 on the live account", not STATE["sent"])

reset(trade_mode=1)
r = post(f"{SECRET},buy,XAUUSD,0.02")
ok("A contest account counts as live too", r.status_code == 403, r.status_code)

print("--- TradingView retrying must not double the position")
reset()
a = post(f"{SECRET},buy,XAUUSD,0.02")
b = post(f"{SECRET},buy,XAUUSD,0.02")
ok("The first goes through, the retry does not",
   a.status_code == 200 and b.status_code == 409, f"{a.status_code} then {b.status_code}")
ok("Only one order reached MT5", len(STATE["sent"]) == 1, len(STATE["sent"]))

print("--- what /api/health says about it")
reset()
h = client.get("/api/health").json()
ok("Health reports the webhook is ready", h.get("webhook_ready") is True
   and h.get("webhook_blocked_because") is None, h.get("webhook_blocked_because"))
server.WEBHOOK = server.webhook.Guard(enabled=False)
h = client.get("/api/health").json()
ok("And says why when it is not", h.get("webhook_ready") is False
   and "WEBHOOK_ENABLED" in str(h.get("webhook_blocked_because")), h.get("webhook_blocked_because"))

reset()
server.WEBHOOK = server.webhook.Guard(enabled=False)
r = post(f"{SECRET},buy,XAUUSD,0.02")
ok("With the webhook off, an alert is refused", r.status_code == 503, f"{r.status_code} {r.text[:70]}")
ok("And nothing reached MT5", not STATE["sent"])

print()
print("all good" if not fails else f"{fails} failing checks")
sys.exit(1 if fails else 0)
