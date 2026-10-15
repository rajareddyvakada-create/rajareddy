#!/usr/bin/env python3
"""Fetch real CFTC COT + Yahoo price data and embed it as the widget's offline snapshot."""
import datetime
import json
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = [
    ROOT / "cot-sentiment-widget.html",
    ROOT / "cot-widget-android/app/src/main/assets/cot-sentiment-widget.html",
]

MARKETS = [
    ("Gold", "088691", "GC=F", "commodity"),
    ("Silver", "084691", "SI=F", "commodity"),
    ("Crude Oil", "067651", "CL=F", "commodity"),
    ("S&P 500", "13874A", "ES=F", "financial"),
    ("Nasdaq", "209742", "NQ=F", "financial"),
    ("Copper", "085692", "HG=F", "commodity"),
    ("Nat Gas", "023651", "NG=F", "commodity"),
    ("Bitcoin", "133741", "BTC-USD", "financial"),
]

FIELDS = {
    "commodity": ("72hh-3qpy", "m_money_positions_long_all", "m_money_positions_short_all",
                  "swap_positions_long_all", "swap__positions_short_all"),
    "financial": ("gpe5-46if", "asset_mgr_positions_long", "asset_mgr_positions_short",
                  "lev_money_positions_long", "lev_money_positions_short"),
}

UA = {"User-Agent": "Mozilla/5.0", "Accept": "*/*"}


def get_json(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 ** (attempt + 1))


def fetch_cot(code, kind):
    ds, al, ash, ll, ls = FIELDS[kind]
    q = urllib.parse.urlencode({
        "$select": f"report_date_as_yyyy_mm_dd,{al},{ash},{ll},{ls},open_interest_all",
        "$where": f"cftc_contract_market_code='{code}'",
        "$order": "report_date_as_yyyy_mm_dd DESC",
        "$limit": "12",
    })
    rows = get_json(f"https://publicreporting.cftc.gov/resource/{ds}.json?{q}")
    out = [[r["report_date_as_yyyy_mm_dd"][:10],
            int(float(r.get(al, 0))) - int(float(r.get(ash, 0))),
            int(float(r.get(ll, 0))) - int(float(r.get(ls, 0))),
            int(float(r.get("open_interest_all", 0)))] for r in rows]
    return out[::-1]


def fetch_coinbase(product):
    candles = get_json(f"https://api.exchange.coinbase.com/products/{product}/candles?granularity=86400")
    daily = [[c[2], c[1], c[4]] for c in candles[:140]][::-1]
    weeks = []
    end = len(daily)
    while end > 0:
        wk = daily[max(0, end - 7):end]
        weeks.insert(0, [max(d[0] for d in wk), min(d[1] for d in wk), wk[-1][2]])
        end -= 7
    return weeks[-20:]


def fetch_yahoo(ticker):
    last = None
    for host in ("query1", "query2"):
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?interval=1wk&range=6mo"
            res = get_json(url)["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            rows = [[round(h, 6), round(l, 6), round(c, 6)]
                    for h, l, c in zip(q["high"], q["low"], q["close"]) if None not in (h, l, c)]
            return rows[-20:]
        except Exception as e:
            last = e
    raise last


def fetch_price(ticker):
    if ticker == "BTC-USD":
        try:
            return fetch_coinbase("BTC-USD")
        except Exception:
            pass
    time.sleep(3)
    return fetch_yahoo(ticker)


def main():
    snap = {"fetchedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "markets": {}}
    for name, code, ticker, kind in MARKETS:
        try:
            cot = fetch_cot(code, kind)
            price = fetch_price(ticker)
            if len(cot) < 5 or len(price) < 10:
                raise ValueError("insufficient history")
            snap["markets"][ticker] = {"cot": cot, "price": price}
            print(f"ok   {name}: {len(cot)} COT weeks, {len(price)} price weeks", file=sys.stderr)
        except Exception as e:
            print(f"FAIL {name}: {e}", file=sys.stderr)
    if not snap["markets"]:
        sys.exit("No market data fetched; snapshot left unchanged.")

    block = "/*SNAPSHOT_START*/const SNAPSHOT = " + json.dumps(snap, separators=(",", ":")) + ";/*SNAPSHOT_END*/"
    pattern = re.compile(r"/\*SNAPSHOT_START\*/.*?/\*SNAPSHOT_END\*/", re.S)
    for path in TARGETS:
        if not path.exists():
            continue
        text = path.read_text()
        if not pattern.search(text):
            sys.exit(f"Snapshot markers missing in {path}")
        path.write_text(pattern.sub(lambda _: block, text))
        print(f"updated {path.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
