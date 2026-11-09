# XM bridge tests

`mock.js` stands in for the MT5 bridge: the same endpoints, auth, JSON shapes and websocket
protocol as `backend/server.py`, so the whole frontend can be tested on Linux with no Windows and
no MetaTrader installed. Its broker clock runs UTC+3, like XM in summer, which is what makes the
time tests meaningful.

    npm i -D playwright
    pip install fastapi httpx      # for the endpoint test only
    ./run.sh

Each suite prints one PASS/FAIL line per check. `run.sh` starts the mock, runs everything and stops
the mock again; set `PORT` if 8711 is taken.

| Suite | What it covers |
|-------|----------------|
| `fe.js` | first load, account details, quotes, orders, positions, errors |
| `sym.js` | symbol search and the Browse picker, mixed-case names, unknown names |
| `hist.js` | older candles loading when you scroll back, and the status strip |
| `slow.js` | symbol changes while MT5 is still downloading history |
| `reload.js` | the page coming back after a restart with the same symbol and settings |
| `ind.js` | applying indicators, lines and marks |
| `pine.js`, `conv3.js` | the Pine Script converter |
| `oxhtf.js` | Ox Alpha UT Pro on its own higher timeframe |
| `settings.js`, `sval.js` | indicator settings, and changes taking effect |
| `clock.test.js` | the broker/device clock switch in the status strip |
| `tz.js` | the clock maths on their own, with the device in Asia/Kolkata |
| `upd.js` | the Update button |
| `test_updater.py` | `backend/updater.py`: refuses junk, oversized and partial downloads |
| `test_webhook.py` | TradingView alert parsing, and every guard that can refuse one |
| `test_webhook_endpoint.py` | the real `/webhook/tradingview` route, with a stand-in MetaTrader5 |
