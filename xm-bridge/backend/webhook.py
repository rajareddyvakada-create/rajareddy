"""TradingView alert handling for the XM bridge.

TradingView posts the alert's message body to a URL. It cannot send custom headers, so the shared
secret travels inside the body and is compared in constant time. Nothing here imports MetaTrader5:
this module is the parsing and the refusing, so it can be tested on any machine, and server.py is
the only place that actually sends an order.

The dangerous part of a webhook is not the parsing, it is that a URL on the internet can open real
positions. Every guard below exists for that reason, and all of them are off-by-default or capped.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any

# What a caller may ask for. "close" means every position on that symbol, either side.
ACTIONS = ("buy", "sell", "close", "closelong", "closeshort", "closeall")

# Field names people actually use in alert messages, mapped to ours.
_LOT_KEYS = ("lot", "lots", "volume", "vol", "size", "qty", "quantity", "amount")
_SL_KEYS = ("sl", "stop", "stoploss", "stop_loss")
_TP_KEYS = ("tp", "target", "takeprofit", "take_profit")
_SECRET_KEYS = ("secret", "passphrase", "password", "key", "token", "license", "licenseid")
_SYMBOL_KEYS = ("symbol", "ticker", "pair", "instrument")
_ACTION_KEYS = ("action", "side", "command", "cmd", "order", "direction", "signal")
_ID_KEYS = ("id", "alert_id", "alertid", "nonce")

_NUM = re.compile(r"^-?\d+(?:\.\d+)?$")


class WebhookRefused(Exception):
    """Raised with a reason safe to log. The HTTP reply says little, the log says everything."""

    def __init__(self, reason: str, *, status: int = 400, quiet: str | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status = status
        # What the caller is told. Deliberately vague for anything auth-related, so a wrong secret
        # cannot be told apart from a malformed body by someone probing the URL.
        self.quiet = quiet or reason


@dataclass
class Alert:
    """One parsed alert. `secret` is kept separate and never logged or echoed."""

    action: str
    symbol: str = ""
    lot: float | None = None
    sl: float | None = None
    tp: float | None = None
    comment: str = "tradingview"
    alert_id: str = ""
    secret: str = ""
    raw_len: int = 0

    def without_secret(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "symbol": self.symbol,
            "lot": self.lot,
            "sl": self.sl,
            "tp": self.tp,
            "comment": self.comment,
            "id": self.alert_id,
        }


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or not _NUM.match(text):
        return None
    return float(text)


def _first(d: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _normalise_action(value: Any) -> str:
    text = str(value or "").strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    aliases = {
        "long": "buy", "b": "buy", "bull": "buy", "enterlong": "buy",
        "short": "sell", "s": "sell", "bear": "sell", "entershort": "sell",
        "exit": "close", "flat": "close", "closeposition": "close",
        "exitlong": "closelong", "closebuy": "closelong",
        "exitshort": "closeshort", "closesell": "closeshort",
        "closeall": "closeall", "flatten": "closeall",
    }
    text = aliases.get(text, text)
    if text not in ACTIONS:
        raise WebhookRefused(f"unknown action {str(value)[:24]!r}")
    return text


def parse_alert(body: bytes | str) -> Alert:
    """Read an alert body in either shape TradingView users write.

    JSON:  {"secret":"s","action":"buy","symbol":"XAUUSD","lot":0.01,"sl":3990,"tp":4010}
    Plain: s,buy,XAUUSD,0.01,sl=3990,tp=4010

    The plain form is the one PineConnector made common, so a Pine script already written for it
    needs only its first field changed to this bridge's secret.
    """
    if isinstance(body, bytes):
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            raise WebhookRefused("body is not UTF-8 text")
    else:
        text = body
    raw_len = len(text)
    text = text.strip()
    if not text:
        raise WebhookRefused("empty body")
    if raw_len > 4096:
        raise WebhookRefused("body is far larger than any alert needs")

    fields: dict[str, Any]
    if text[0] in "{[":
        try:
            loaded = json.loads(text)
        except json.JSONDecodeError as exc:
            raise WebhookRefused(f"body starts like JSON but will not parse: {exc.msg}")
        if not isinstance(loaded, dict):
            raise WebhookRefused("JSON body must be an object")
        fields = {str(k).strip().lower(): v for k, v in loaded.items()}
        positional: list[str] = []
    else:
        parts = [p.strip() for p in text.split(",")]
        fields = {}
        positional = []
        for part in parts:
            if "=" in part:
                k, _, v = part.partition("=")
                fields[k.strip().lower()] = v.strip()
            elif part:
                positional.append(part)
        # <secret>,<action>,<symbol>[,<lot>]
        if positional:
            fields.setdefault("secret", positional[0])
        if len(positional) > 1:
            fields.setdefault("action", positional[1])
        if len(positional) > 2:
            fields.setdefault("symbol", positional[2])
        if len(positional) > 3:
            fields.setdefault("lot", positional[3])

    action_raw = _first(fields, _ACTION_KEYS)
    if action_raw is None:
        raise WebhookRefused("no action in the alert (buy, sell, close…)")
    action = _normalise_action(action_raw)

    symbol = str(_first(fields, _SYMBOL_KEYS) or "").strip()
    # TradingView tickers often carry the exchange, e.g. "OANDA:XAUUSD" or "XAUUSD.P".
    if ":" in symbol:
        symbol = symbol.rsplit(":", 1)[1]
    symbol = symbol.removesuffix(".P").removesuffix(".p").strip()
    if len(symbol) > 32:
        raise WebhookRefused("symbol is too long to be an MT5 symbol")
    if symbol and not re.fullmatch(r"[A-Za-z0-9._#&-]+", symbol):
        raise WebhookRefused("symbol has characters no MT5 symbol uses")
    if action != "closeall" and not symbol:
        raise WebhookRefused(f"{action} needs a symbol")

    comment = str(_first(fields, ("comment", "note", "text")) or "tradingview").strip()[:31]

    return Alert(
        action=action,
        symbol=symbol,
        lot=_num(_first(fields, _LOT_KEYS)),
        sl=_num(_first(fields, _SL_KEYS)),
        tp=_num(_first(fields, _TP_KEYS)),
        comment=comment or "tradingview",
        alert_id=str(_first(fields, _ID_KEYS) or "").strip()[:64],
        secret=str(_first(fields, _SECRET_KEYS) or ""),
        raw_len=raw_len,
    )


@dataclass
class Guard:
    """Every reason this bridge will refuse to trade an alert.

    Defaults are the cautious ones: the webhook is off, and even switched on it will not touch a
    live account until that is turned on separately. The point is that turning the webhook on
    cannot, by itself, put real money at risk.
    """

    enabled: bool = False
    secret: str = ""
    max_lot: float = 0.10
    default_lot: float = 0.01
    symbols: tuple[str, ...] = ()          # empty means any symbol the account has
    allow_live: bool = False               # refuse on a real account unless explicitly allowed
    per_minute: int = 30
    api_key: str = ""                      # only to refuse a webhook secret that reuses it
    dedupe_seconds: float = 60.0
    _recent: dict[str, float] = field(default_factory=dict, repr=False)
    _times: list[float] = field(default_factory=list, repr=False)

    # ---------------------------------------------------------------- configuration

    def why_unusable(self) -> str | None:
        """What stops this guard from ever accepting an alert, for /api/health to report."""
        if not self.enabled:
            return "WEBHOOK_ENABLED is not true in .env"
        if len(self.secret) < 16:
            return "WEBHOOK_SECRET is missing or shorter than 16 characters"
        if self.max_lot <= 0:
            return "WEBHOOK_MAX_LOT is not above zero"
        if self.api_key and self.secret == self.api_key:
            # The webhook secret is stored by TradingView with the alert, so it is the one value
            # here that leaves this PC. Reusing API_KEY would hand out the key to everything.
            return "WEBHOOK_SECRET is the same as API_KEY; use a different value"
        return None

    # ---------------------------------------------------------------- checks

    def check(self, alert: Alert, *, is_demo: bool, now: float | None = None) -> Alert:
        """Return the alert with its lot settled, or raise WebhookRefused.

        Order matters: the secret is checked before anything that could tell a prober how the
        bridge is configured.
        """
        now = time.time() if now is None else now

        blocked = self.why_unusable()
        if blocked:
            # Not 401: the caller may hold the right secret and the server is simply not set up.
            raise WebhookRefused(f"webhook is not usable: {blocked}", status=503,
                                 quiet="webhook is not enabled on this bridge")

        if not alert.secret or not hmac.compare_digest(alert.secret, self.secret):
            raise WebhookRefused("wrong or missing secret", status=401, quiet="refused")

        if not is_demo and not self.allow_live:
            raise WebhookRefused(
                "this is a live account and WEBHOOK_ALLOW_LIVE is not true in .env",
                status=403,
                quiet="this bridge will not trade a live account from a webhook",
            )

        self._prune(now)
        if len(self._times) >= self.per_minute:
            raise WebhookRefused(f"more than {self.per_minute} alerts in a minute", status=429,
                                 quiet="too many alerts")

        key = alert.alert_id or self._fingerprint(alert)
        seen_at = self._recent.get(key)
        if seen_at is not None and now - seen_at < self.dedupe_seconds:
            # TradingView retries a webhook it thinks failed, and a retry must not double the
            # position. Refusing is the safe answer, not sending again.
            raise WebhookRefused(
                f"same alert already handled {now - seen_at:.0f}s ago", status=409,
                quiet="duplicate alert ignored",
            )

        if alert.action in ("buy", "sell"):
            lot = alert.lot if alert.lot is not None else self.default_lot
            if lot <= 0:
                raise WebhookRefused("lot must be above zero")
            if lot > self.max_lot:
                raise WebhookRefused(
                    f"lot {lot} is above the webhook cap of {self.max_lot} (WEBHOOK_MAX_LOT)")
            alert.lot = lot
        else:
            alert.lot = None

        if self.symbols and alert.symbol and alert.symbol.upper() not in self.symbols:
            raise WebhookRefused(
                f"{alert.symbol} is not in WEBHOOK_SYMBOLS", status=403,
                quiet="that symbol is not allowed from a webhook")

        # Only remembered once it has passed everything, so a refused alert can be corrected and
        # sent again without tripping the duplicate check.
        self._recent[key] = now
        self._times.append(now)
        return alert

    # ---------------------------------------------------------------- housekeeping

    def _prune(self, now: float) -> None:
        self._times = [t for t in self._times if now - t < 60.0]
        if len(self._recent) > 512:
            cutoff = now - self.dedupe_seconds
            self._recent = {k: t for k, t in self._recent.items() if t > cutoff}

    @staticmethod
    def _fingerprint(alert: Alert) -> str:
        """An alert with no id of its own is identified by what it asks for."""
        basis = f"{alert.action}|{alert.symbol}|{alert.lot}|{alert.sl}|{alert.tp}"
        return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:32]


def guard_from_env(getenv) -> Guard:
    """Build the guard from .env. `getenv` is passed in so this stays testable."""

    def flag(name: str, default: str = "false") -> bool:
        return str(getenv(name, default)).strip().lower() in ("1", "true", "yes", "on")

    def number(name: str, default: float) -> float:
        try:
            return float(str(getenv(name, "")).strip() or default)
        except ValueError:
            return default

    raw_symbols = str(getenv("WEBHOOK_SYMBOLS", "") or "").strip()
    symbols = tuple(s.strip().upper() for s in raw_symbols.split(",") if s.strip())

    return Guard(
        enabled=flag("WEBHOOK_ENABLED"),
        secret=str(getenv("WEBHOOK_SECRET", "") or "").strip(),
        max_lot=number("WEBHOOK_MAX_LOT", 0.10),
        default_lot=number("WEBHOOK_DEFAULT_LOT", 0.01),
        symbols=symbols,
        allow_live=flag("WEBHOOK_ALLOW_LIVE"),
        per_minute=int(number("WEBHOOK_PER_MINUTE", 30)),
        api_key=str(getenv("API_KEY", "") or "").strip(),
    )
