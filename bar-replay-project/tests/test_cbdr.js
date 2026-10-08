// Unit tests for src/cbdr.js (pure logic). Run: node tests/test_cbdr.js
'use strict';
const assert = require('assert');
const { analyse, nyInfo } = require('../src/cbdr.js');

// Build 1-minute bars from New York wall-clock times (October = EDT, UTC-4).
function nyBars(startYmd, startHM, minutes, priceAt) {
  const [y, mo, d] = startYmd; const [H, M] = startHM;
  const out = [];
  let t = Date.UTC(y, mo - 1, d, H + 4, M) / 1000; // NY 00:00 + 4h = UTC
  for (let i = 0; i < minutes; i++, t += 60) {
    const p = priceAt(i, t);
    out.push({ time: t, open: p.o, high: p.h, low: p.l, close: p.c });
  }
  return out;
}
const opts = (over) => Object.assign({
  instantOf: b => b.time, baseSec: 60, useBodies: true, skipSun: true,
  wideMax: 0, tpSd: 1, slPad: 0.5, setupOn: true
}, over);

// --- NY clock conversion
assert.deepStrictEqual(nyInfo(Date.UTC(2026, 9, 6, 18, 30) / 1000).min, 14 * 60 + 30, 'EDT: 18:30 UTC is 14:30 NY');
assert.strictEqual(nyInfo(Date.UTC(2026, 9, 6, 18, 30) / 1000).ymd, '2026-10-06');
assert.strictEqual(nyInfo(Date.UTC(2026, 0, 6, 19, 30) / 1000).min, 14 * 60 + 30, 'EST: 19:30 UTC is 14:30 NY');

// --- Scenario 1: CBDR 14-20 NY, range 1990..2010 (bodies), then a sweep of the low and a reclaim (long)
// Tuesday 6 Oct 2026, bars from 13:00 NY to 13:00 NY the next day.
const path = (i, t) => {
  const m = (13 * 60 + i) % 1440; // NY minute of day, starting at 13:00
  let o = 2000, c = 2000, h = 2001, l = 1999;
  if (m >= 14 * 60 && m < 20 * 60) { // CBDR: bodies between 1990 and 2010, wicks wider
    const k = m % 10;
    o = 1995 + k; c = 1996 + k; h = 2012; l = 1988;
  }
  if (m === 22 * 60) { o = 1992; c = 1989; h = 1992; l = 1988; } // sweep below 1990, close inside
  if (m === 22 * 60 + 5) { o = 1989; c = 1992; h = 1993; l = 1988.5; } // reclaim above 1990 → long entry at 1992
  if (m === 23 * 60) { o = 2005; c = 2012; h = 2031; l = 2004; } // target 2030 hit
  return { o, h, l, c };
};
const bars = nyBars([2026, 10, 6], [13, 0], 24 * 60, path);
const res = analyse(bars, opts());
const cb = res.ranges.find(r => r.name === 'CBDR' && r.ymd === '2026-10-06');
assert(cb, 'CBDR range found for 6 Oct');
// Bodies only: highest body top 2005, lowest body bottom 1995 (wicks reach 2012 / 1988 and are ignored)
assert.strictEqual(cb.hi, 2005); assert.strictEqual(cb.lo, 1995); assert.strictEqual(cb.h, 10);
assert.strictEqual(res.setups.length, 1, 'exactly one setup');
const s = res.setups[0];
assert.strictEqual(s.side, 'long');
assert.strictEqual(s.outcome, 'tp', 'target reached');
assert.strictEqual(s.sl, 1987.5, 'stop = sweep low - 0.5');
assert.strictEqual(s.entry, 2000, 'entry on the first close back above the CBDR low');
assert.strictEqual(s.tp, 2015, 'target = CBDR high + 1 SD');
assert(s.R > 0, 'winning R is positive');
console.log('  long setup: entry', s.entry, 'sl', s.sl.toFixed(2), 'tp', s.tp.toFixed(2), 'rr', s.rr.toFixed(2), 'outcome', s.outcome, 'R', s.R.toFixed(2));

// --- Scenario 2: wick mode makes the range wider, and the setup still uses the new range
const res2 = analyse(bars, opts({ useBodies: false }));
const cb2 = res2.ranges.find(r => r.name === 'CBDR' && r.ymd === '2026-10-06');
assert.strictEqual(cb2.hi, 2012); assert.strictEqual(cb2.lo, 1988);
console.log('  CBDR 6 Oct (wicks): hi', cb2.hi, 'lo', cb2.lo);

// --- Scenario 3: WIDE filter switches setups off but keeps the range
const res3 = analyse(bars, opts({ wideMax: 5 }));
assert(res3.ranges.find(r => r.name === 'CBDR' && r.wide), 'range flagged WIDE');
assert.strictEqual(res3.setups.length, 0, 'no setups on a WIDE CBDR');

// --- Scenario 4: a Sunday CBDR is ignored
const sunBars = nyBars([2026, 10, 4], [13, 0], 24 * 60, path); // Sunday 4 Oct 2026
const res4 = analyse(sunBars, opts());
assert(!res4.ranges.some(r => r.name === 'CBDR'), 'no Sunday CBDR when skipSun is on');
const res4b = analyse(sunBars, opts({ skipSun: false }));
assert(res4b.ranges.some(r => r.name === 'CBDR' && r.ymd === '2026-10-04'), 'Sunday CBDR appears when skipSun is off');

// --- Scenario 5: short setup (sweep of the high, close back below)
const pathS = (i) => {
  const m = (13 * 60 + i) % 1440;
  let o = 2000, c = 2000, h = 2001, l = 1999;
  if (m >= 14 * 60 && m < 20 * 60) { o = 2000; c = 2005; h = 2010; l = 1990; } // CBDR high 2010 (wick), body high 2005
  if (m === 21 * 60) { o = 2008; c = 2011; h = 2012; l = 2007; c = 2011; } // sweep high 2012 (body close 2011 > 2010 → no reclaim yet)
  if (m === 21 * 60 + 5) { o = 2009; c = 2008; h = 2009.5; l = 2007; } // close back below 2010 (body high 2005 → it is below the wick)
  if (m === 22 * 60) { o = 1985; c = 1980; h = 1986; l = 1965; } // target = CBDR low (1990) - 1 SD (20) = 1970 hit
  return { o, h, l, c };
};
const resS = analyse(nyBars([2026, 10, 6], [13, 0], 24 * 60, pathS), opts({ useBodies: false }));
const sS = resS.setups[0];
assert(sS, 'short setup found');
assert.strictEqual(sS.side, 'short');
assert.strictEqual(sS.outcome, 'tp');
console.log('  short setup: entry', sS.entry, 'sl', sS.sl, 'tp', sS.tp, 'outcome', sS.outcome, 'R', sS.R.toFixed(2));

console.log('All CBDR tests passed');
