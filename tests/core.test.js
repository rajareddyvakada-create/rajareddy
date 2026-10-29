// Unit tests for the app's calculations. Run: node --test tests/
// Expected values are worked out by hand in the comments, not taken from the code under test.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ASSETS = path.join(__dirname, '../cot-widget-android/app/src/main/assets/charts');
const Core = require(path.join(ASSETS, 'core.js'));

// indicators.js is a browser script: run it with a stub window and take its exported tools.
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(ASSETS, 'indicators.js'), 'utf8'), { window:win, Math, console });
const T = win.ChartIndicatorTools;

// Pull single function declarations out of news.html (they don't touch the DOM).
const newsSrc = fs.readFileSync(path.join(ASSETS, 'news.html'), 'utf8');
function extract(name){
  const i = newsSrc.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' not found in news.html');
  let depth = 0, j = newsSrc.indexOf('{', i);
  for(let k = j; k < newsSrc.length; k++){ if(newsSrc[k] === '{') depth++; else if(newsSrc[k] === '}' && --depth === 0) return newsSrc.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
}
const news = vm.runInNewContext(extract('parseDeviation') + extract('jaccard') + extract('nyToUtc') + ';({parseDeviation, jaccard, nyToUtc})', { HOUR:3600000, Intl, Date });

/* ---------- COT ---------- */
const row = (date, aL, aS, bL, bS, oi) => ({ report_date_as_yyyy_mm_dd:date + 'T00:00:00.000',
  m_money_positions_long_all:String(aL), m_money_positions_short_all:String(aS),
  swap_positions_long_all:String(bL), swap__positions_short_all:String(bS), open_interest_all:String(oi) });

test('COT: net = long − short, sorted oldest first, using the correct CFTC fields', () => {
  const { rows, dropped } = Core.parseCot([row('2026-10-20', 120970, 16764, 17737, 238536, 402279), row('2026-10-13', 100, 40, 5, 25, 900)], 'commodity');
  assert.equal(dropped, 0);
  // Gold, 20 Oct 2026 (real CFTC values): managed money 120,970 − 16,764 = 104,206; swap dealers 17,737 − 238,536 = −220,799
  assert.deepEqual(rows, [['2026-10-13', 60, -20, 900], ['2026-10-20', 104206, -220799, 402279]]);
});

test('COT: missing / malformed fields are dropped, never read as zero; duplicate dates kept once', () => {
  const bad = row('2026-10-06', 1, 1, 1, 1, 1); delete bad.swap__positions_short_all;
  const neg = row('2026-09-29', -5, 1, 1, 1, 1);
  const { rows, dropped } = Core.parseCot([row('2026-10-13', 10, 0, 0, 0, 5), row('2026-10-13', 99, 0, 0, 0, 5), bad, neg, { report_date_as_yyyy_mm_dd:'junk' }, null], 'commodity');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], 10);   // first row for the date kept
  assert.equal(dropped, 5);
  assert.throws(() => Core.parseCot({ message:'Rate limited' }, 'commodity'), /Rate limited/);
});

test('COT: financial markets use asset managers and leveraged funds', () => {
  const r = { report_date_as_yyyy_mm_dd:'2026-10-20', asset_mgr_positions_long:'1101642', asset_mgr_positions_short:'200265',
    lev_money_positions_long:'135034', lev_money_positions_short:'506279', open_interest_all:'1935470' };
  // S&P 500 e-mini, 20 Oct 2026: 1,101,642 − 200,265 = 901,377; 135,034 − 506,279 = −371,245
  assert.deepEqual(Core.parseCot([r], 'financial').rows[0], ['2026-10-20', 901377, -371245, 1935470]);
});

const weeks = (spec) => spec.map((s, i) => ['2026-09-' + String(1 + i * 7).padStart(2, '0'), s[0], s[1], s[2]]);
const DISC = { zone:'DISCOUNT', weeks:20 }, PREM = { zone:'PREMIUM', weeks:20 };

test('COT score: everything bullish in discount = +100', () => {
  // A 100→150 over 4 weeks (+50), B 10→12 this week (mean |B| 10.4, limit 12.48, not extreme), OI +100
  // discount with A rising +35, A up in discount +30, B up +20, OI up with A buying +15 = 100
  const s = Core.scoreCot(weeks([[100, 10, 1000], [110, 10, 1000], [120, 10, 1000], [130, 10, 1000], [150, 12, 1100]]), DISC, 'commodity');
  assert.equal(s.score, 100);
  assert.equal(s.verdict, 'Bullish');
  assert.equal(s.tInst, 50);
});

test('COT score: an unchanged position is not counted as selling (changed behaviour)', () => {
  // premium with A unchanged: −35 (zone, change ≤ 0), A 0, B unchanged 0, OI up but A flat 0 → −35 Lean bearish.
  // The old code also took −30 for "cut 0 net longs", giving −65 Bearish.
  const s = Core.scoreCot(weeks([[100, 5, 1000], [100, 5, 1000], [100, 5, 1000], [100, 5, 1000], [100, 5, 1200]]), PREM, 'commodity');
  assert.equal(s.score, -35);
  assert.equal(s.verdict, 'Lean bearish');
  assert.ok(s.notes.some(n => /unchanged over 4 weeks/.test(n[1])));
  assert.ok(s.notes.some(n => /Open interest rising, managed money flat/.test(n[1])));
});

test('COT score: an unusually large B position counts against its move', () => {
  // B 10,10,10,10,30: mean 14, limit 16.8, |30| > 16.8 → extreme; B rose → −10.
  // discount, A 100→90 (−10): zone +20, A down in discount −12, B −10, OI flat 0 → −2 Neutral
  const s = Core.scoreCot(weeks([[100, 10, 1000], [100, 10, 1000], [100, 10, 1000], [100, 10, 1000], [90, 30, 1000]]), DISC, 'commodity');
  assert.equal(s.score, -2);
  assert.equal(s.verdict, 'Neutral');
});

test('COT labels: swap dealers are never called fast money; categories match the report', () => {
  const rows = weeks([[100, 10, 1000], [110, 10, 1000], [120, 10, 1000], [130, 10, 1000], [150, 12, 1100]]);
  const c = Core.scoreCot(rows, DISC, 'commodity'), f = Core.scoreCot(rows, DISC, 'financial');
  const all = x => x.notes.map(n => n[1]).join(' | ');
  assert.match(all(c), /Swap dealers added 2 net longs this week/);
  assert.match(all(c), /Managed money added 50 net longs over 4 weeks/);
  assert.match(all(f), /Leveraged funds added 2/);
  assert.match(all(f), /Asset managers added 50/);
  for(const s of [all(c), all(f)]){ assert.doesNotMatch(s, /fast money/i); assert.doesNotMatch(s, /institution/i); }
  assert.equal(c.report, 'Disaggregated · futures only');
});

test('COT score: fewer than 5 weeks is refused rather than guessed', () => {
  assert.throws(() => Core.scoreCot(weeks([[1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]]), DISC, 'commodity'), /Not enough COT history/);
});

test('Premium/discount: position in the 20-week range; flat range = 50 (discount)', () => {
  // high 120, low 90, close 118 → (118 − 90) / 30 = 93.3% → premium
  const pd = Core.premiumDiscount([[110, 90, 95], [120, 100, 118]]);
  assert.equal(pd.pos, 93); assert.equal(pd.zone, 'PREMIUM');
  const flat = Core.premiumDiscount([[100, 100, 100]]);
  assert.equal(flat.pos, 50); assert.equal(flat.zone, 'DISCOUNT');
  assert.throws(() => Core.premiumDiscount([[NaN, 1, 1]]), /No valid weekly prices/);
});

test('COT freshness: Tuesday data is normally 3–10 days old; over 13 days is stale', () => {
  assert.deepEqual(Core.cotFreshness('2026-10-20', Date.parse('2026-10-29T12:00:00Z')), { ageDays:9, stale:false });
  assert.equal(Core.cotFreshness('2026-10-20', Date.parse('2026-11-03T00:00:00Z')).stale, true);
  assert.equal(Core.cotFreshness('', Date.now()).stale, true);
});

/* ---------- candles and feeds ---------- */
test('Candles: sorted, duplicates removed (later wins), impossible bars dropped', () => {
  const b = (time, o, h, l, c) => ({ time, open:o, high:h, low:l, close:c });
  const { bars, dropped } = Core.cleanCandles([b(120, 2, 3, 1, 2), b(60, 1, 2, 0.5, 1.5), b(120, 2, 4, 1, 3), b(180, 2, 1.9, 1, 2), b(240, NaN, 1, 1, 1), b(300, -1, 1, -2, 0.5)]);
  assert.deepEqual(bars.map(x => [x.time, x.high]), [[60, 2], [120, 4]]);
  assert.equal(dropped, 4);   // one duplicate + high below open + NaN + negative
});

test('Feed status: live, stale after max(2 min, 3 candles), off, history', () => {
  const now = 1_000_000_000;
  assert.equal(Core.feedStatus({ online:true, state:'on', lastTickMs:now - 5000, tfSec:60, now }), 'live');
  assert.equal(Core.feedStatus({ online:true, state:'on', lastTickMs:now - 181000, tfSec:60, now }), 'stale');   // 1m chart: 3 candles = 3 min
  assert.equal(Core.feedStatus({ online:true, state:'on', lastTickMs:now - 600000, tfSec:300, now }), 'live');   // 5m chart: 15 min limit
  assert.equal(Core.feedStatus({ online:true, state:'off', lastTickMs:now, tfSec:60, now }), 'off');
  assert.equal(Core.feedStatus({ online:false }), 'history');
});

/* ---------- trades ---------- */
test('Levels: stop and target must be on the correct side; zero distance refused', () => {
  assert.equal(Core.checkLevels('long', 100, 98, 104).ok, true);
  assert.equal(Core.checkLevels('short', 100, 102, 96).ok, true);
  assert.match(Core.checkLevels('long', 100, 101, 104).errors[0], /below the entry/);
  assert.match(Core.checkLevels('short', 100, 102, 104).errors[0], /target must be below/);
  assert.equal(Core.checkLevels('long', 100, 100, 104).ok, false);
  assert.equal(Core.checkLevels('up', 100).ok, false);
});

test('Risk/reward after costs', () => {
  // long 100, stop 98, target 104, cost 0.2: risk 2 + 0.2 = 2.2, reward 4 − 0.2 = 3.8, R:R 3.8 / 2.2 = 1.7273
  const r = Core.riskReward('long', 100, 98, 104, 0.2);
  assert.ok(Math.abs(r.risk - 2.2) < 1e-9 && Math.abs(r.reward - 3.8) < 1e-9);
  assert.ok(Math.abs(r.rr - 1.727272) < 1e-5);
});

test('Position size uses the market\'s real contract size, or refuses', () => {
  // gold $100 risk, 10-dollar stop, 100 oz per lot: 100 / (10 × 100) = 0.1 lot
  assert.ok(Math.abs(Core.positionSize(100, 4000, 3990, 'XAU/USD').lots - 0.1) < 1e-12);
  // silver $100 risk, 0.20 stop, 5,000 oz: 100 / (0.2 × 5000) = 0.1
  assert.ok(Math.abs(Core.positionSize(100, 48, 47.8, 'XAG/USD').lots - 0.1) < 1e-9);
  assert.equal(Core.positionSize(100, 1, 0.9, 'EURUSD').lots, null);
  assert.equal(Core.positionSize(100, 1, 1, 'XAU/USD').lots, null);
});

test('Stop/target inside one candle: stop assumed first; gaps fill at the open', () => {
  const L = { side:'long', sl:98, tp:104 }, S = { side:'short', sl:102, tp:96 };
  const both = Core.barExit(L, { open:100, high:105, low:97, close:101 });
  assert.equal(both.price, 98); assert.match(both.reason, /stop assumed first/);
  assert.equal(Core.barExit(L, { open:96, high:97, low:95, close:96 }).price, 96);       // gapped below the stop
  assert.equal(Core.barExit(L, { open:100, high:105, low:99, close:104 }).price, 104);
  assert.equal(Core.barExit(L, { open:106, high:107, low:105, close:106 }).price, 106);  // gapped above the target
  assert.equal(Core.barExit(L, { open:100, high:103, low:99, close:101 }), null);
  assert.equal(Core.barExit(S, { open:100, high:103, low:95, close:99 }).price, 102);
  assert.equal(Core.barExit(S, { open:100, high:101, low:95, close:96 }).price, 96);
});

test('R multiple after costs', () => {
  // long 100 → 104, stop distance 2, cost 0.2: (4 − 0.2) / 2 = 1.9
  assert.ok(Math.abs(Core.rMultiple('long', 100, 104, 2, 0.2) - 1.9) < 1e-12);
  assert.ok(Math.abs(Core.rMultiple('short', 100, 102, 2, 0) + 1) < 1e-12);
});

test('AI proposals: demo or stale prices and bad levels are refused', () => {
  const live = { price:4000, feed:'live', demo:false };
  assert.equal(Core.validateProposal({ side:'long', sl:3990, tp:4020 }, live).ok, true);
  assert.match(Core.validateProposal({ side:'long', sl:3990 }, { ...live, demo:true }).errors[0], /demo/);
  assert.match(Core.validateProposal({ side:'long', sl:3990 }, { ...live, feed:'stale' }).errors[0], /stale/);
  assert.match(Core.validateProposal({ side:'long', sl:4010 }, live).errors[0], /below the entry/);
  assert.match(Core.validateProposal({ side:'short', sl:4300 }, live).errors[0], /more than 5%/);
  assert.equal(Core.validateProposal({ side:'long', sl:'abc' }, live).ok, false);
  assert.equal(Core.validateProposal({ side:'long' }, { ...live, feed:'history' }).ok, true);   // replaying history is fine
});

test('Confluence score is 50…95 and grows with agreement', () => {
  assert.equal(Core.confluence(0), 50);
  assert.equal(Core.confluence(-40), 70);
  assert.equal(Core.confluence(100), 95);
});

/* ---------- indicators ---------- */
test('ATR(3): SMA seed, then Wilder smoothing', () => {
  const c = [[10, 8, 9], [11, 9, 10], [12, 10, 11], [13, 9, 10]].map(([h, l, cl], i) => ({ time:i, open:cl, high:h, low:l, close:cl }));
  // TR: 2, max(2, |11−9|, |9−9|) = 2, 2, max(4, 3, 2) = 4. ATR[2] = (2+2+2)/3 = 2; ATR[3] = (4 + 2×2)/3 = 2.6667
  const a = T.rmaATR(c, 3);
  assert.ok(isNaN(a[0]) && isNaN(a[1]));   // not enough bars yet
  assert.equal(a[2], 2);
  assert.ok(Math.abs(a[3] - 8 / 3) < 1e-12);
});

test('Timeframe aggregation: 1-minute bars into 5-minute candles', () => {
  const c = [0, 60, 120, 300, 360].map((t, i) => ({ time:t, open:i + 1, high:i + 2, low:i, close:i + 1.5, volume:1 }));
  const { bars, idx } = T.aggregate(c, 300);
  assert.deepEqual(JSON.parse(JSON.stringify(bars.map(b => [b.time, b.open, b.high, b.low, b.close, b.volume]))), [[0, 1, 4, 0, 3.5, 3], [300, 4, 6, 3, 5.5, 2]]);
  assert.deepEqual([...idx], [0, 0, 0, 1, 1]);
});

test('UT Bot: short after price crosses below its trailing stop, long after it crosses back above', () => {
  // ATR(3) = 1 on these bars (high − low = 1, no gaps between equal closes). From 20 the stop trails at 19;
  // the drop to 10 crosses below it (short), the stop then trails at 11 and the jump to 20 crosses above (long).
  const c = [20, 20, 20, 20, 10, 10, 10, 20, 21].map((x, i) => ({ time:i, open:x, high:x + 0.5, low:x - 0.5, close:x }));
  const u = T.utBot(c, 1, 3, false);
  assert.equal(u.stop[3], 19);
  assert.equal(u.pos[4], -1);
  assert.equal(u.pos[7], 1);
});

/* ---------- news ---------- */
test('News: forecast vs actual parsed from a headline', () => {
  const plain = x => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(news.parseDeviation('US CPI 0.4% vs 0.3% expected')), { actual:0.4, expected:0.3, dev:0.4 - 0.3, unit:'%' });
  assert.deepEqual(plain(news.parseDeviation('Nonfarm payrolls 150K (exp 180K)')), { actual:150, expected:180, dev:-30, unit:'K' });
  assert.equal(news.parseDeviation('Gold rises on safe-haven demand'), null);
});

test('News: the same story from two outlets is detected as a duplicate', () => {
  const w = s => new Set(s.toLowerCase().match(/[a-z]{4,}/g));
  assert.ok(news.jaccard(w('Fed holds rates steady, signals patience on cuts'), w('Fed holds rates steady and signals patience on cuts')) > 0.5);
  assert.ok(news.jaccard(w('Fed holds rates steady'), w('China gold imports surge in September')) < 0.5);
});

test('News calendar: New York time converted to UTC across daylight saving', () => {
  // 8:30 New York: summer (EDT, UTC−4) = 12:30 UTC; winter (EST, UTC−5) = 13:30 UTC
  assert.equal(new Date(news.nyToUtc(2026, 6, 10, 8, 30)).toISOString(), '2026-07-10T12:30:00.000Z');
  assert.equal(new Date(news.nyToUtc(2026, 11, 4, 8, 30)).toISOString(), '2026-12-04T13:30:00.000Z');
});
