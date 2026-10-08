# Bar Replay — project handoff

This project was built in a claude.ai chat and moved here to continue in Claude Code.
Read this whole file before changing anything.

## Who it's for

- The owner is a gold (XAUUSD) day trader. He trades on MT5 (broker symbols like `GOLD.i#`) and uses **UT Bot Alerts** signals.
- He mostly works from an **Android phone** and is not a programmer. Give short, clear, step-by-step instructions. Ask before anything that costs money.
- His trading rules, used as defaults in the app: never risk more than **$30 per trade**, stop-loss about **$6–7 price distance** (default 6.5), **1:2** reward to risk, one open trade at a time.

## What exists

| Deliverable | Where | Status |
|---|---|---|
| MT5 bar-replay EA | `mql5/BarReplay.mq5` | Delivered. **Never compiled** (no MetaEditor available). Creates a custom symbol `<SYMBOL>_REPLAY`, feeds M1 bars on a timer, buttons Play/Next candle/Slower/Faster polled via OBJPROP_STATE. |
| claude.ai artifact (CSV replay) | `dist/bar-replay.html`, live at https://claude.ai/artifact/DPghBKoCXdBRqAoKoaPdmf | Working. CSV only: claude.ai pages cannot call external APIs or use Google login. |
| Chrome extension v2 (MV3) | `dist/bar-replay-extension/` (+ zip) | Working in tests. Live data + Google sign-in. Google client ID not yet set by the owner. |
| Website (GitHub Pages) | `dist/bar-replay-website/` (+ zip) | Working in tests. **Owner uploaded it but says the site "is not opening" — unresolved.** We asked for his URL or a screenshot. |
| TradingView indicator (CBDR + entry model) | `pine/cbdr_entry_model.pine` | Written by hand, **not compiled** in TradingView yet. Same rules as the app. |
| Download page | https://claude.ai/artifact/PXaEQ9FQdpJku73MjcWJNi | Lets him re-download the zips (claude.ai file cards kept disappearing on his phone). |

## First thing to do next

Help him get the website open. Ask for his GitHub Pages URL (or screenshot) and check, in this order:
1. Settings → Pages shows "Your site is live"; first build can take ~5 min.
2. Files at the **repo root** (not inside a `bar-replay-website/` folder) and not uploaded as the `.zip`.
3. Repo is Public; Pages source = Deploy from a branch, `main`, `/ (root)`.
4. Page loads but stuck on "Checking sign-in…" → `config.js` syntax broken (client ID must be inside quotes).
5. Google error `origin_mismatch` → Authorised JavaScript origin must be exactly `https://USERNAME.github.io` (no path, no trailing slash).
6. Data errors → see "Not verified" below.

## Other planned work (he asked or agreed earlier)

- Add his **STC filter** and **1H bias** so signals match his TradingView script. His STC rule: SELL only when STC > 80 and the line just turned green→red; BUY only when STC < 27 and it just turned red→green. Signals only after bar close (no repainting).
- Real access control / paid access / syncing trades across devices would need a backend (e.g. Firebase). Not started.
- Possibly publish the extension to the Chrome Web Store (remove `key` from manifest for upload; the store assigns its own key).

## Layout

```
build.py                 builds everything into dist/  (python3 build.py; needs Pillow)
src/template_web_v1.html  + replay_web_v1.js   → dist/bar-replay.html (claude.ai artifact, CSV only)
src/template_ext.html     shared page for extension AND website (build.py patches it for the website)
src/replay_ext.js         the app (used by extension and website as replay.js)
src/auth.js               extension sign-in: chrome.identity.launchWebAuthFlow, implicit flow, then /oauth2/v3/userinfo
src/auth_web.js           website sign-in: Google Identity Services button, decodes the ID-token JWT client-side
src/cbdr.js               CBDR / Asian / Flout ranges and entry setups (pure logic, tests/test_cbdr.js)
pine/cbdr_entry_model.pine  TradingView version of the same rules
src/data.js               online data: Binance + Twelve Data (history + live)
src/README_*.txt          end-user setup guides copied into each build
vendor/                   TradingView Lightweight Charts v4.2.3 (Apache 2.0) — v4 API: addCandlestickSeries, setMarkers
keys/ext_key.b64          public key in manifest "key" → fixed extension ID odiolklmlggafpajcjkhjncimmgbccad
keys/ext_key.pem          matching PRIVATE key (only needed to pack a .crx). Keep private, never publish.
tests/run_tests.py        Playwright end-to-end tests with all network faked (tests/mock.js, tests/mockweb.js)
```

Website files must stay **flat (no subfolders)** so he can upload them from a phone.
MV3 rule: no inline scripts in extension pages. Lightweight Charts is bundled locally (no remote code).

## How the app works (replay_ext.js)

- `bars` = base bars (usually 1-minute), times in **local wall-clock seconds** (epoch shifted by timezone offset; naive CSV times are shown as written).
- `idx` = how many base bars are revealed. `agg` = candles of the chosen timeframe built from `bars[0..idx)` via `bucket(t)`.
- Play reveals base bars one at a time (candles build live); "Next candle" completes the current candle; Back/scrub/pick go through `jumpTo()`.
- **UT Bot**: incremental, matches Pine (`ta.atr` = RMA of true range, trailing stop, crossover rules). Only **closed** candles get signals (`closedCount()`; in live mode the newest candle is open until its end time passes). Defaults key 1, ATR 10. Verified against a separate reference implementation.
- **Practice trades**: fill at last close; SL/TP from settings; if one bar touches both SL and TP → counted as a loss; gaps fill at the bar open. Moving back before an open trade's entry removes it.
- **Live**: `loadSource()` loads history, then `BRData.stream()` calls `ingest()`; when the replay is at the end (`idx === bars.length`) new bars are shown immediately, otherwise they queue as hidden future bars. Badge: Live / Connecting / Offline / API limit / "Replay, go live".
- Storage: `localStorage` keys prefixed `u:<google sub>:` per signed-in user; CSV bars in IndexedDB; signed-in user in `chrome.storage.local` (extension) or `localStorage.br_user` (website).

## Data sources (data.js)

- Default: **Binance PAXGUSDT** (gold-backed token, close to spot gold, trades 24/7). REST `data-api.binance.vision` → fallback `api.binance.com`; WebSocket `data-stream.binance.vision` → fallback `stream.binance.com:9443`. Gap-fills via REST on reconnect.
- **Twelve Data** `XAU/USD`: user's own free key (800 credits/day, 8/min). History up to 5000 bars per request (paged with `end_date`); live = one poll per minute.
- TradingView's own data cannot be used (no public data API); only its chart library.

## Not verified (no real network in the claude.ai sandbox)

Everything was tested only with faked responses. Unverified against the real services:
- Binance / Twelve Data **CORS from a normal website** (the extension has host_permissions, the website does not).
- Real Google sign-in in both versions.
- The MT5 EA compiling.
If something breaks for real, these are the first suspects.

## Testing

```
pip install playwright pillow && python -m playwright install chromium
python3 build.py && python3 tests/run_tests.py
```

## CBDR and entry model (added)

- `src/cbdr.js` finds the CBDR (14:00-20:00 NY), Asian (20:00-24:00) and Flout (14:00-24:00) ranges per New York date, with SD projections.
- Entry model (our reading of the CBDR notes, not an ICT-verified rule): long when price takes out the CBDR low and a candle closes back above it; entry at that close; stop below the sweep low minus padding; target at CBDR high + N x height. Short is the mirror. One setup per CBDR day, looked for until 12:00 NY the next day. Stop wins if one bar touches both.
- Drawn on `#overlay` (canvas over the chart). Setups are graphics only; they do not open practice trades.
- Time zone: Binance / Twelve Data times are converted exactly. CSV times use the "CSV times are UTC +" setting (MT5 server time is often UTC+2/+3).
- Not ported from the Pine notes: the ATR-based WIDE option and the "Asian only when CBDR is WIDE" option.
- `tests/test_cbdr.js` runs with `node tests/test_cbdr.js`.
- The Pine version differs in two small ways: it draws only the newest open setup (one at a time), and it has no history limit (old drawings stay on the chart).
