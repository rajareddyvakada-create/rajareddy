// Tests for user indicator scripts (assets/charts/scripts.js). Run: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const S = require(path.join(__dirname, '../cot-widget-android/app/src/main/assets/charts/scripts.js'));

const bars = closes => ({ time:closes.map((_, i) => i * 60), open:closes, high:closes.map(c => c + 1), low:closes.map(c => c - 1), close:closes, volume:closes.map(() => 0) });

test('ta helpers: SMA, EMA and crossovers by hand', () => {
  const ta = S.makeTa(bars([1, 2, 3, 4, 5]));
  assert.deepEqual(ta.sma([1, 2, 3, 4, 5], 3).slice(2), [2, 3, 4]);
  // EMA(3): alpha 0.5, seeded with the first value: 1, 1.5, 2.25, 3.125
  assert.deepEqual(S.makeTa(bars([1, 2, 3, 4])).ema([1, 2, 3, 4], 3), [1, 1.5, 2.25, 3.125]);   // series match the candle count
  assert.deepEqual(ta.crossover([1, 3, 3], [2, 2, 2]), [false, true, false]);
  assert.deepEqual(ta.crossunder([3, 1, 1], 2), [false, true, false]);
  assert.deepEqual(ta.highest([1, 5, 2, 4], 2).slice(1), [5, 5, 4]);
});

test('The built-in template runs and gives a BUY when the fast EMA crosses up', () => {
  const closes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 9, 8, 7, 8, 10, 12, 14, 16];
  const out = S.runScript(S.TEMPLATE, bars(closes));
  assert.equal(out.buy.length, closes.length);
  assert.ok(out.buy.some(Boolean), 'expected a BUY after the rise');
  const i = out.buy.findIndex(Boolean);
  assert.ok(out.sl[i] < closes[i], 'BUY stop must be below the close');
  assert.deepEqual(Object.keys(out.plots), ['EMA 9', 'EMA 21']);
});

test('Script output is normalised: bad values dropped, lengths fixed', () => {
  const out = S.runScript('return { buy:[1, 0], sell:"x", sl:[1, "a", NaN], plots:{ a:[1, 2, 3, 4, 5, 6] } };', bars([1, 2, 3]));
  assert.deepEqual(out.buy, [true, false, false]);
  assert.deepEqual(out.sell, [false, false, false]);
  assert.ok(Number.isNaN(out.sl[1]) && Number.isNaN(out.sl[2]) && out.sl[0] === 1);
  assert.equal(out.plots.a.length, 3);
});

test('Script errors are reported, not swallowed', () => {
  assert.throws(() => S.runScript('return undefinedThing.x;', bars([1, 2])), /undefinedThing/);
  assert.throws(() => S.runScript('this is not javascript', bars([1, 2])), SyntaxError);
});
