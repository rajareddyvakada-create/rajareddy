// The Pine converter, exercised on real scripts inside the page.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8200 + Math.floor(Math.random() * 180);
const BASE = 'http://localhost:' + PORT + '/';
const bridge = spawn(process.execPath, [__dirname + '/mock.js'], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
const stopBridge = () => { try { bridge.kill(); } catch (e) {} };
process.on('exit', stopBridge);

const R = [];
const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));

const EMA_CROSS = `//@version=5
indicator("EMA Cross", overlay=true)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
buySig = ta.crossover(fast, slow)
sellSig = ta.crossunder(fast, slow)
plot(fast, "Fast EMA", color=color.aqua)
plot(slow, "Slow EMA", color=color.orange)
plotshape(buySig, title="Buy", location=location.belowbar, style=shape.triangleup, color=color.green)
plotshape(sellSig, title="Sell", location=location.abovebar, style=shape.triangledown, color=color.red)`;

const RSI_PREV = `//@version=5
indicator("RSI turn")
len = input.int(14, "Length")
r = ta.rsi(close, len)
up = r > 50 and r[1] <= 50
dn = r < 50 and r[1] >= 50
plot(r, "RSI")
plotshape(up, title="Long", style=shape.triangleup)
plotshape(dn, title="Short", style=shape.triangledown)`;

const MACD_BB = `//@version=5
indicator("MACD and bands", overlay=true)
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
basis = ta.sma(hl2, 20)
dev = 2 * ta.stdev(hl2, 20)
plot(basis, "Basis")
plot(basis + dev, "Upper")
plot(macdLine, "MACD")`;

const WITH_LOOP = `//@version=5
indicator("Has a loop")
total = 0.0
for i = 0 to 5
    total := total + close[i]
avg = total / 6
plot(avg, "Avg")
bgcolor(color.new(color.red, 90))`;

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => {
    try {
      if (!localStorage.getItem('xm.key')) {
        localStorage.setItem('xm.key', 'test-key-123');
        localStorage.setItem('xm.symbol', 'GOLD');
        localStorage.setItem('xm.tf', 'M5');
      }
    } catch (e) {}
  });
  await p.goto(BASE);
  await p.waitForFunction(() => getComputedStyle(document.getElementById('chartMsg')).display === 'none', null, { timeout: 25000 });
  await p.waitForTimeout(600);

  const open = async () => { await p.click('#indBtn'); await p.waitForTimeout(250); await p.click('#indNew'); await p.waitForTimeout(250); };
  const paste = async code => { await p.fill('#edCode', code); };
  const msg = () => p.textContent('#edMsg');
  const convert = async () => { await p.click('#edPine'); await p.waitForTimeout(500); };
  const check = async () => { await p.click('#edCheck'); await p.waitForFunction(() => /Works\.|Stopped|not defined|is not|SyntaxError|Unexpected|Load a chart/.test(document.getElementById('edMsg').textContent), null, { timeout: 15000 }); return msg(); };

  // 1. pasting Pine and pressing Check says what it is and what to do
  await open();
  await paste(EMA_CROSS);
  let m = await check();
  ok('Pasted Pine fails with a pointer to the converter', /looks like Pine Script/.test(m) && /Convert from Pine/.test(m), m.replace(/\s+/g, ' ').slice(0, 90));

  // 2. converting it, then running it
  await convert();
  const converted = await p.inputValue('#edCode');
  ok('Converted code uses the editor API', /ta\.ema\(bars\.close, fastLen\)/.test(converted) && /input\(9, "Fast"/.test(converted) && /plots: \{ "Fast EMA"/.test(converted), (converted.split('\n').find(l => /input\(9/.test(l)) || '').trim());
  ok('Name picked up from indicator()', (await p.inputValue('#edName')) === 'EMA Cross', await p.inputValue('#edName'));
  m = await check();
  ok('Converted EMA cross runs and draws', /Works\. 2 lines \(Fast EMA, Slow EMA\)/.test(m) && /BUY and/.test(m), m.replace(/\s+/g, ' ').slice(0, 110));
  const marks = /(\d+) BUY and (\d+) SELL/.exec(m);
  ok('It produced both buy and sell marks', marks && +marks[1] > 0 && +marks[2] > 0, marks ? marks[0] : 'none');

  // 3. history access r[1] and and/or keywords
  await paste(RSI_PREV);
  await convert();
  const rsiJs = await p.inputValue('#edCode');
  ok('Previous-bar access becomes ta.prev', /ta\.prev\(r, 1\)/.test(rsiJs), (rsiJs.split('\n').find(l => /ta\.prev/.test(l)) || '').trim());
  ok('Pine and/or become JavaScript operators', /&&/.test(rsiJs) && !/\sand\s/.test(rsiJs));
  m = await check();
  const rsiMarks = /(\d+) BUY and (\d+) SELL/.exec(m);
  ok('Converted RSI script runs and really marks candles', /Works\./.test(m) && rsiMarks && +rsiMarks[1] > 0 && +rsiMarks[2] > 0, m.replace(/\s+/g, ' ').slice(0, 95));
  ok('Comparisons became per-candle maths', /bars\.close\.map\(\(_, __i\)/.test(rsiJs), (rsiJs.split('\n').find(l => /__i/.test(l)) || '').trim().slice(0, 80));

  // 4. tuple unpacking and hl2
  await paste(MACD_BB);
  await convert();
  const macdJs = await p.inputValue('#edCode');
  ok('ta.macd tuple is unpacked', /const macdLine = __t\d+\.macd;/.test(macdJs), (macdJs.split('\n').find(l => /macdLine =/.test(l)) || '').trim());
  ok('hl2 is computed from the bars', /__hl2 = bars\.high\.map/.test(macdJs));
  m = await check();
  ok('Converted MACD script runs', /Works\. 3 lines/.test(m), m.replace(/\s+/g, ' ').slice(0, 90));

  // 5. what it cannot do, it says
  await paste(WITH_LOOP);
  await convert();
  const loopMsg = await msg();
  const loopJs = await p.inputValue('#edCode');
  ok('Loops are reported, not silently dropped', /blocks are not converted/.test(loopMsg), loopMsg.replace(/\s+/g, ' ').slice(0, 100));
  ok('And the loop body is left as comments', /\/\/ for i = 0 to 5/.test(loopJs) && /\/\/ total := total/.test(loopJs));
  ok('TradingView-only drawing is reported', /bgcolor/.test(loopMsg), /bgcolor/.test(loopMsg) ? 'bgcolor noted' : loopMsg.slice(0, 60));

  // 6. refuses to mangle something that is not Pine
  await paste('const x = ta.ema(bars.close, 5); return { plots: { x } };');
  await p.click('#edPine');
  await p.waitForTimeout(400);
  const same = await p.inputValue('#edCode');
  ok('Already-JavaScript code is left alone', /return \{ plots: \{ x \} \}/.test(same));

  await p.click('#edClose');
  await p.waitForTimeout(300);
  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  stopBridge();
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); stopBridge(); process.exit(1); });
