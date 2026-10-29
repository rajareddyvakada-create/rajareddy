# COT Sentiment app: audit and repair report (v2.3)

Scope: the whole repository (Android shell in `cot-widget-android/`, pages in `cot-sentiment-widget.html` and
`cot-widget-android/app/src/main/assets/charts/`, build scripts in `scripts/`, CI in `.github/workflows/`).

## How the app is built

| Part | What it is |
|---|---|
| Android shell | Java, AGP 8.2, compileSdk/targetSdk 34, minSdk 24. One `MainActivity` with a WebView loading `file:///android_asset/index.html`; `AppBridge` exposes native functions to the pages. |
| Pages | Plain HTML/JS (no framework). Tabs: Markets (COT), Charts (Lightweight Charts + replay + AI agent), Scanner, News, Journal, Me. Each tab after Markets is an iframe page in `assets/charts/`. |
| Shared maths | New `assets/charts/core.js`: COT parsing and scoring, candle checks, feed freshness, trade levels, sizing, stop/target fills, AI order checks, Claude calls. |
| Background | `VerdictWorker` (WorkManager, every 3 h) re-scores markets with `MarketScanner` + `Scoring` (Java copy of the COT score). `NewsReminderWorker` posts calendar reminders. |
| Data sources | CFTC Socrata (Disaggregated futures-only `72hh-3qpy`, TFF futures-only `gpe5-46if`), Yahoo Finance chart API (futures, 10-min delayed), Swissquote public quotes (spot gold/silver), Binance (crypto, PAXG), Coinbase (BTC weekly), Twelve Data (optional key), RSS/news feeds, ForexFactory calendar. |
| Storage | WebView localStorage (trades `chart.bar-replay-trades`, journal `journal.*`, caches), Android SharedPreferences (alerts, account), new encrypted store for the Claude key. |
| Tests before this audit | None. |

## Bugs found

### P0: security and data integrity

| # | Where | Problem | Status |
|---|---|---|---|
| P0-1 | `agent.js`, `journal.html` | Claude API key kept in WebView localStorage and sent from page JavaScript (`anthropic-dangerous-direct-browser-access`). Any script in the page could read it. | **Fixed.** New `SecretStore.java` encrypts the key with an AES-256-GCM key held in the Android Keystore; new `ClaudeProxy.java` makes the request natively. Pages can save or clear the key but can't read it. An old key in localStorage is moved into the encrypted store and deleted on first launch (`Core.migrateApiKey`). The proxy only reaches `/v1/messages`, checks the request (model, `max_tokens` ≤ 16,000, no streaming, ≤ 400 KB) and allows at most 30 requests per 10 minutes. |
| P0-2 | `cot-sentiment-widget.html`, `replay.js`, `news.html` | `postMessage` listeners accepted messages from any window. | **Fixed.** The shell accepts only messages from its own tab iframes with a typed object; tab pages accept only their parent. Origins can't be named because the pages are local files (opaque `null` origin), so the sender's window identity is checked instead. |
| P0-3 | `fetchCOT` (JS), `MarketScanner.scan` (Java), `update_cot_snapshot.py` | A missing or non-numeric CFTC field was read as **0** (`Number(x) \|\| 0`, `optDouble(f, 0)`, `r.get(f, 0)`), silently creating fake positions. Duplicate report dates were not handled. | **Fixed** in all three: such rows are dropped, duplicates are kept once, rows are sorted by date, and fewer than 5 valid weeks refuses to score. |
| P0-4 | `replay.js` | When market data failed to load, random demo candles were shown with a dismissible notice. After dismissal nothing showed they were fake. The agent analysed them, and practice trades on them went into the journal's results. | **Fixed.** Permanent “DEMO DATA · random prices, not market history” badge. Agent analysis and all agent orders are refused on demo data. Demo trades are flagged `demo:true`, labelled DEMO in the journal and excluded from its statistics; older records are recognised by name without rewriting them. |

### P1: wrong calculations or misleading data

| # | Where | Problem | Status |
|---|---|---|---|
| P1-1 | Markets cards, score sheet | **Swap dealers were called “Fast money”** and managed money / asset managers were called “Institutions”. | **Fixed.** Notes and labels use the CFTC names: Managed money + Swap dealers (commodities), Asset managers + Leveraged funds (financials). Covered by a test that fails on “fast money” or “institution”. |
| P1-2 | `scoreMarket` / `Scoring.score` | A 4-week change of exactly 0 was scored as a **cut** (−12 or −30). | **Fixed:** an unchanged position scores 0. See formula changes. |
| P1-3 | `scoreMarket` | “Open interest flat or falling” was shown while open interest was **rising** (when the group was flat). | **Fixed** wording. |
| P1-4 | `agent.js` | “95% confidence” was a rescaled score, not a probability. | **Fixed:** shown as “Confluence 72/100 · not a probability of winning”, with each component, the formula and missing inputs. Claude is told never to call it a probability. |
| P1-5 | `agent.js` | COT input used without a freshness check; missing inputs were not shown. | **Fixed:** COT older than 13 days and news older than 6 hours are left out and listed under “Not included”, never counted as neutral. |
| P1-6 | `replay.js openPos` | An AI stop-loss or target on the **wrong side** was silently replaced by the default distance, and the order still opened. | **Fixed:** refused (`Core.checkLevels`); every agent/Claude order goes through `Core.validateProposal` (real price, live feed, correct sides, stop ≤ 5 %, target ≤ 20 % away). |
| P1-7 | `replay.js checkTrade` | With trailing on, the stop was checked only on candle **close**, while the target filled on touch (optimistic), and a candle hitting both favoured the target. | **Fixed:** stops (trailing too) fill on touch, gaps fill at the open, and when one candle contains both levels the **stop is assumed first** (conservative). |
| P1-8 | `replay.js` | Lot size used one “contract size (gold = 100)” for every market, so silver, oil and the indices were wrong. | **Fixed:** real contract sizes per market (`Core.CONTRACTS`; spot gold 100 oz and silver 5,000 oz CFD lots, CME/COMEX/NYMEX futures specs). Unknown markets show “size n/a” instead of a guess; the setting now applies only to CSV files. |
| P1-9 | `replay.js` | No trading costs. | **Added** “Spread + commission per trade (price)” setting; R and P&L subtract it. Default 0 keeps old results comparable. Set it to your broker's spread. |
| P1-10 | `replay.js announceSignal`, agent | BUY/SELL notifications and agent setups could fire while the live feed was stalled or the market closed. | **Fixed:** a feed status (`live` / `stale` / `off` / `history`) is tracked. Stale = no new price for max(2 min, 3 candles). Signals and setups need `live`; the badge says “No new price: market closed or feed stalled”. |
| P1-11 | Data loaders, scanner, weekly prices | Candles were not checked for order, duplicates or impossible values. | **Fixed:** `Core.cleanCandles` sorts, de-duplicates and drops bars whose high/low don't contain open/close or that have non-positive prices (chart history, live ticks, scanner). Weekly COT prices skip impossible bars (JS and Java). |

### P2: reliability and UX

| # | Where | Problem | Status |
|---|---|---|---|
| P2-1 | Markets cards | COT report age not shown; a missed weekly report went unnoticed. | **Fixed:** “COT 20 Oct 2026 (9 days old)” and a stale warning past 13 days; saved prices say “Prices saved …, not live”; report family shown. |
| P2-2 | Scanner | A saved result from an earlier day showed only a time. | **Fixed:** date shown when not today, source named, “saved result” after 15 minutes. |
| P2-3 | Journal | Manual trades accepted zero prices, close before open and double submits; failed saves were silent; delete had no confirmation. | **Fixed.** |
| P2-4 | Agent | Auto-trade sent an “AI agent BUY” notification even when the order was refused. | **Fixed.** |
| P2-5 | Claude calls | Responses were not checked for the documented shape. | **Fixed:** `Core.claude` / `Core.claudeText` reject unreadable or unexpected responses with a clear message. |

## Calculation changes (old → new)

COT score (`Core.scoreCot`, Java `Scoring.score`); all point values are unchanged except:

| Component | Old | New |
|---|---|---|
| Group A 4-week change = 0 | −12 (discount) / −30 (premium), note “cut 0 net longs” | 0, note “unchanged over 4 weeks” |
| Open interest up, group A flat | 0, note “flat or falling” | 0, note “rising, … flat: no signal” |
| Missing CFTC field | read as 0 | row dropped |
| < 5 valid weeks | scored with whatever was there | refused |

Practice trading:

| Item | Old | New |
|---|---|---|
| Stop with trailing on | candle close beyond the stop | price touches the stop |
| Stop and target in one candle | target first (trailing on) | stop first, always |
| R multiple | (exit − entry) × dir ÷ stop distance | same, minus spread + commission |
| Lots | risk ÷ (stop × 100) for every market | risk ÷ (stop × contract size of that market), or n/a |
| Agent levels on the wrong side | replaced by default distance | order refused |
| Agent “confidence %” | 50 + \|score\| ÷ 2, shown as % | same number, shown as confluence /100, not a probability |

## Tests added

* `tests/core.test.js`, 25 Node tests (`node --test tests/*.test.js`): COT net positions with real CFTC values; field mapping for both reports; dropped and duplicate rows; score cases worked out by hand (+100, unchanged = −35, extreme group = −2); labels; minimum history; premium/discount including a flat range; COT freshness; candle cleaning; feed status thresholds; level sides; R:R after costs; position size (gold, silver, unknown, zero stop); stop/target fills incl. gaps and same-candle rule; R after costs; AI order validation (demo, stale, wrong side, too far, non-numeric); confluence range; ATR(3) by hand; timeframe aggregation; UT Bot flips; news forecast/actual parsing; duplicate headline detection; New York → UTC across daylight saving.
* `cot-widget-android/app/src/test/java/com/cot/widget/ScoringTest.java`, 4 JUnit tests: the same score cases for the Java background checker.
* CI now runs both before building the APK.
* End-to-end browser check (live data, local files like the WebView), 17 checks: card labels and COT age; real chart not demo; feed status; wrong-side buy refused; agent confluence/missing/formula; agent order validated; gold lot size; demo badge, agent blocked and demo trade flagged when data can't load; journal excludes demo; scanner stamp; no script errors.

## Results

* Node unit tests: 25 passed, 0 failed.
* Java scoring tests: 4 passed, 0 failed (run locally with javac; CI runs them with JUnit 4.13.2 via `./gradlew testDebugUnitTest`).
* End-to-end: 17 passed, 0 failed.
* Syntax check of every script and inline script: clean.
* Android build: run by GitHub Actions (no Android SDK in this environment). See the v2.3 release.

## Not verified here (needs live credentials, a device, or a decision)

* **Physical Android device:** Keystore encryption, the native Claude proxy, notifications, the TradingView/XM overlays and back navigation were compiled but not run on a phone.
* **Claude calls:** not exercised (no API key here). Error paths are covered by code review, not by a live call.
* **Backend:** there is no server. The key stays on the phone (encrypted) and the app calls Anthropic directly, which is reasonable for a personal app; a shared app would need a server with its own authentication. If the key was ever pasted anywhere else, rotate it at console.anthropic.com.
* **File-URL access:** the main WebView keeps `setAllowUniversalAccessFromFileURLs(true)`, which the pages need to call market-data APIs from `file://`. Moving to `WebViewAssetLoader` would change the page origin and **erase every saved trade and setting**, so it was not done. All feed text is HTML-escaped before display.
* **News and calendar:** parsing helpers are tested; live provider formats (RSS, ForexFactory, GDELT, Finnhub) were not re-audited one by one. News stays an input with a stated reason per headline, not a prediction.
* **Spot-gold shift:** Yahoo futures are shifted to spot with a PAXG-measured basis; small differences from your broker's price remain possible.
* **Costs default to 0** so old results stay comparable; set your spread in Charts → Settings.

## Rebuild and install

1. Push to the branch: GitHub Actions runs the tests, builds the APK and publishes release `v<versionName>` (`.github/workflows/build-apk.yml`).
2. Locally: `python3 scripts/build_android_asset.py`, `node --test tests/*.test.js`, then in `cot-widget-android/`: `./gradlew testDebugUnitTest assembleDebug` (needs JDK 17 and Android SDK 34). The APK is `app/build/outputs/apk/debug/app-debug.apk`.
3. On the phone: open the APK and allow installs from this source. It installs over the previous version and keeps your trades and settings. No environment variables are needed; the Claude key is entered in the app.
