# XM Trading App — MT5 bridge + web frontend

A personal trading app for one XM account. A small Python server runs on your Windows PC next to the
MetaTrader 5 terminal; your phone or laptop opens a web page over home WiFi and gets **live prices with
no broker delay**, a candlestick chart, and Buy / Sell buttons.

```
  XM servers  <->  MT5 terminal (Windows, logged in)
                        |  local pipe
                   backend/server.py   (FastAPI: REST + WebSocket)
                        |  home WiFi
                   frontend/index.html (phone / laptop browser)
```

Prices come straight from your own MT5 terminal, so the chart is the same price XM fills you at.

---

## 1. What you need

| | |
|---|---|
| Windows PC | The MT5 Python package is Windows-only. The PC must stay on while you trade. |
| MetaTrader 5 | Installed and **logged into your XM account** (real or demo). |
| Python | **64-bit** Python 3.10, 3.11 or 3.12. 32-bit Python cannot talk to a 64-bit terminal. |

## 2. Install

```bat
cd xm-bridge\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 3. Turn on Algo Trading in MT5

In the terminal: **Tools → Options → Expert Advisors → tick "Allow algorithmic trading"**, and make sure
the **Algo Trading** button in the toolbar is green. Without this every order comes back with
`10027 Algo Trading is switched off`.

## 4. Fill in `.env`

**Easiest:** double-click **`start.bat`**. The first time, it runs a short setup that finds your MT5
terminal, asks for the account number, password and server, generates the API key and writes `.env`
for you. Your password is typed on the PC and saved only in that file.

Or write it by hand: copy `.env.example` to `.env` (in the `xm-bridge` folder) and edit it:

```ini
MT5_PATH=C:\Program Files\XM Global MT5\terminal64.exe
MT5_LOGIN=12345678
MT5_PASSWORD=your-mt5-password
MT5_SERVER=XMGlobal-MT5
API_KEY=a-long-random-string
MAX_LOT=1.0
```

* `MT5_PATH` — right-click your MT5 shortcut → Properties → copy the **Target**.
* `MT5_LOGIN` / `MT5_SERVER` — the account number and server shown in MT5 under
  **File → Login to Trade Account** (XM uses names like `XMGlobal-MT5`, `XMGlobal-MT5 2`).
* `API_KEY` — make one with: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
* `MAX_LOT` — a hard cap. The server refuses any order larger than this, whatever the page sends.

`.env` holds your trading password. It is git-ignored; never share or commit it.

## 5. Run

**Easiest:** double-click **`start.bat`** in the `xm-bridge` folder. It sets Python up the first time,
starts the server, and prints the addresses to use.

Or by hand:

```bat
cd xm-bridge\backend
.venv\Scripts\activate
uvicorn server:app --host 0.0.0.0 --port 8000
```

You should see:

```
MT5 connected: account 12345678 (Your Name) on XMGlobal-MT5, balance 10000.00 USD, algo trading ON
```

Open the page:

* on the PC → <http://localhost:8000>
* on the phone → `http://<PC-IP>:8000` (find the IP with `ipconfig`, e.g. `http://192.168.1.20:8000`)

The page asks once for the API key and remembers it on that device.

**First time on Windows:** allow Python through the firewall for **Private networks** when prompted, or the
phone cannot reach the PC.

### Why the page must come from your own PC

The chart is real only when the page is served by this server. A copy of the page opened from anywhere
else (a preview link, a file on the phone) cannot reach your PC: it is on your home network, and browsers
block a page on one site from calling a different one. So always open `http://<PC-IP>:8000`.

## 6. Using it

* **Symbol** — type the exact MT5 name (`XAUUSD`, `EURUSD`, `US30Cash`…) and tap **Apply**. Names differ
  between XM account types; check the Market Watch window in MT5.
* **Timeframes** — M1, M5, M15, H1, H4, D1.
* **Bid / Ask** — updates about 5 times a second and flashes green or red on change.
* **Lot size** — the `−` / `+` buttons step by 0.01.
* **BUY / SELL** — sends a market order straight to XM and shows the terminal's own reply.
* **Open positions** — refreshes every 5 seconds, with a **Close** button on each row.
* **Older candles** load by themselves as you scroll back. The line under the chart says how many
  are loaded, how many the terminal keeps, and which clock the times are on.

### Indicators

**Indicators** in the toolbar lists your scripts, switches each on or off, and opens the editor.

Real Pine Script only runs on TradingView's own servers, so scripts here are JavaScript written in
the same shape, with Pine-style helpers:

```js
const fast = ta.ema(bars.close, 9);
const slow = ta.ema(bars.close, 21);
return {
  plots: { "EMA 9": fast, "EMA 21": slow },   // up to 6 lines on the chart
  buy:  ta.crossover(fast, slow),             // true on a candle = BUY arrow
  sell: ta.crossunder(fast, slow)
};
```

`bars.open`, `bars.high`, `bars.low`, `bars.close`, `bars.volume` and `bars.time` are arrays,
oldest first. Helpers: `ta.sma` `ta.ema` `ta.rma` `ta.rsi(src, len)` `ta.atr(len)` `ta.highest`
`ta.lowest` `ta.change` `ta.crossover(a, b)` `ta.crossunder(a, b)` `ta.nz(src)`.

#### Ox Alpha UT Pro

**Add Ox Alpha UT Pro** in the Indicators sheet installs a hand-written port of the Pine original:
the UT Bot trailing stop and direction, the structure, CVD and POC-side filters, the slow-UT filter,
and the "wait for the filters to agree, then one signal per leg" rule. It draws the UT stop, the
session POC and the previous day's high and low.

Its settings are the named values at the top of the script (`KEY`, `ATRP`, `SWING`, `WAIT`,
`USE_STRUCT` and so on) — tap **Edit** and change them.

Left out, because the chart here cannot do them: the higher-timeframe UT (`request.security` — switch
the chart's own timeframe instead), intrabar CVD (needs tick data the bridge does not fetch), and
anything drawn with labels, boxes or tables (the trade map and the dashboard).

#### Pasting Pine Script

**Convert from Pine** rewrites a pasted Pine indicator into the form above. It handles the common
shape: `input.*` values, `ta.*` calls, `close[1]` history, `and` / `or` / `not`, `hl2` and friends,
`plot()`, `plotshape()`, `ta.macd` and `ta.bb` unpacking, and — importantly — Pine's whole-series
arithmetic, so `basis + dev` and `rsi > 50` are worked out candle by candle instead of becoming
nonsense.

It cannot do `if` / `for` blocks, `var` values that persist between bars, `request.security`, or
anything that draws on TradingView itself (`bgcolor`, `label`, `line`, `box`, `table`). Those are
left in as comments and listed above the editor, so you always see what was dropped. **Read the
converted script before trading on it.**

#### Settings

Each indicator has a **Settings** button in the list. It holds:

* **Values** the script declared with `input(...)` — lengths, multiples, filters on and off.
* **Lines** — a colour and a show/hide switch for every line the script draws.
* **Marks** — show or hide its BUY / SELL arrows.

Declare a value and it appears there, no code editing afterwards:

```js
const len = input.int(14, "Length", { min: 1 });
const useFilter = input(true, "Use the filter");
const mult = input(1.5, "ATR multiple", { min: 0.1, step: 0.1 });
```

`input.int` rounds to whole numbers; `min`, `max` and `step` bound the field. A converted Pine script
gets this for free: its `input.int(14, "Length", minval=1)` becomes exactly the line above.

**Check** runs the script on the candles on screen and reports what it drew. A script that throws
is never saved. Scripts run in a Web Worker with no access to the page, your API key or the bridge,
and one that runs for more than four seconds is stopped. They are stored in the browser on that
device, so each phone or laptop keeps its own.

---

## API

Every endpoint needs the header `X-API-Key: <your key>`. The WebSocket takes it as `?key=` instead,
because browsers cannot set headers on a WebSocket.

| Method | Path | Does |
|---|---|---|
| GET | `/api/health` | Server and MT5 status (no key needed) |
| GET | `/api/account` | Balance, equity, margin, free margin, open P/L |
| GET | `/api/symbols?search=XAU&all=false` | Symbols (Market Watch by default) |
| GET | `/api/candles?symbol=XAUUSD&timeframe=M5&count=200` | OHLC history |
| POST | `/api/order` | `{symbol, direction:"buy"\|"sell", lot, sl?, tp?}` |
| GET | `/api/positions?symbol=` | Open positions |
| POST | `/api/close` | `{ticket, lot?}` — omit `lot` to close it all |
| WS | `/ws/ticks?symbol=XAUUSD&key=…` | Live bid/ask about every 200 ms |

Times in candles and ticks are **broker server time** (XM is UTC+2 / UTC+3), passed through unchanged so
the chart matches MT5 itself.

## Safety notes

* This is a personal tool for a home network. **Do not port-forward it to the internet** — anyone with the
  key could trade your account. Over WiFi only.
* `MAX_LOT` in `.env` is your protection against a typo in the lot box.
* Test everything on an XM **demo** account first.
* The server never crashes on an MT5 error: it returns the terminal's own code and message
  (for example `10019 Not enough money`, `10018 Market is closed`).

---

## Test checklist

Run these in order on a **demo account**, with the market open (gold and forex trade Sunday 22:00 to
Friday 21:00 UTC).

**1. Connection**
- [ ] Start the server. The log says `MT5 connected: account … algo trading ON`.
- [ ] Open <http://localhost:8000/api/health> — `mt5_connected: true`, `algo_trading_enabled: true`.
- [ ] If it says algo trading OFF, fix it in MT5 (step 3) and restart.

**2. Key check**
- [ ] `curl http://localhost:8000/api/account` with no key → **401**.
- [ ] With `-H "X-API-Key: <key>"` → your balance. The numbers must match MT5's Trade tab.

**3. Candles**
- [ ] Open the page. A candlestick chart appears within a second or two.
- [ ] Tap M1, then H1. The chart reloads and the shape matches the same chart in MT5.
- [ ] Type a wrong symbol and Apply → a clear "Unknown symbol" message, and the server keeps running.

**4. Live ticks**
- [ ] The status dot is green and says **live**.
- [ ] Bid and Ask change and flash; the spread matches MT5's Market Watch.
- [ ] The newest candle grows as ticks arrive, and a new one starts at the next period.
- [ ] Stop the server → status goes to "price feed disconnected"; start it again → back to **live** by itself.

**5. A small order**
- [ ] Set the lot to the minimum (0.01) and tap **BUY**.
- [ ] A green toast shows the fill price and ticket number.
- [ ] The same position appears in MT5's Trade tab with comment `xm-bridge` — the ticket numbers match.
- [ ] It appears in **Open positions** within 5 seconds, with live P/L.
- [ ] Set the lot to 999 and tap BUY → refused, with a message, and **nothing is sent to the broker**.

**6. Closing**
- [ ] Tap **Close** on the position. A green toast confirms it.
- [ ] The row disappears, and MT5's Trade tab is empty too; the deal shows in History.
- [ ] Balance and equity in the top bar update.

**7. From the phone**
- [ ] On the phone browser open `http://<PC-IP>:8000`, enter the key once.
- [ ] Everything above works, and the layout fits the screen without sideways scrolling.
- [ ] Lock and unlock the phone → the page reconnects to the price feed by itself.

### If something fails

| Symptom | Cause and fix |
|---|---|
| `Couldn't connect to the MT5 terminal` | Terminal not running, wrong `MT5_PATH`, or 32-bit Python. |
| `Connected to the terminal but not logged in` | Wrong login / password / server in `.env`. |
| `10027 Algo Trading is switched off` | Step 3. |
| `10030 Unsupported filling mode` | Rare on XM; the server already picks the symbol's allowed mode. Report the symbol name. |
| `10018 Market is closed` | Weekend, or the symbol's session is closed. |
| Phone can't open the page | Windows Firewall, or the phone is on a different WiFi network / guest network. |
