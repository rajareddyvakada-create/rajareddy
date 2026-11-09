// History loads itself as you scroll back; times use this device's clock; a symbol change
// re-reads once. The stand-in runs a UTC+3 broker clock, the browser is UTC+5:30.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8600 + Math.floor(Math.random() * 180);
const BASE = 'http://localhost:' + PORT + '/';
const bridge = spawn(process.execPath, [__dirname + '/mock.js'], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
const stopBridge = () => { try { bridge.kill(); } catch (e) {} };
process.on('exit', stopBridge);

const R = [];
const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));
const barsOf = t => Number((t.match(/([\d,]+) candles/) || [0, '0'])[1].replace(/,/g, ''));

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'Asia/Kolkata' });
  const p = await ctx.newPage();
  const errs = [], candleReqs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { if (r.url().includes('/api/candles')) candleReqs.push(r.url()); });
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
  await p.waitForTimeout(1000);
  const strip = () => p.textContent('#strip');

  ok('No buttons left in the strip', (await p.$$('#strip button')).length === 0);
  let st = await strip();
  const first = barsOf(st);
  ok('Says how many candles are loaded and kept', first >= 300 && first <= 302 && /of 5,000 the terminal keeps/.test(st), st);
  ok('Times use this device clock, named', /times on your clock \(UTC\+5:30\)/.test(st), st);

  // sitting still must not pull in history
  await p.waitForTimeout(2500);
  ok('Nothing loads while the chart is untouched', barsOf(await strip()) <= first + 2, await strip());

  // scrolling back loads older candles by itself
  const box = await p.locator('#chart').boundingBox();
  for (let i = 0; i < 6; i++) {
    await p.mouse.move(box.x + 60, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width - 40, box.y + box.height / 2, { steps: 10 });
    await p.mouse.up();
    if (barsOf(await strip()) > first + 100) break;
    await p.waitForTimeout(700);
  }
  await p.waitForTimeout(1500);
  st = await strip();
  ok('Scrolling back loads older candles on its own', barsOf(st) >= first + 499, first + ' -> ' + barsOf(st));

  // changing symbol re-reads once on its own
  candleReqs.length = 0;
  await p.fill('#symbolInput', 'EURUSD');
  await p.click('#applySymbol');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('chartMsg')).display === 'none', null, { timeout: 25000 });
  const afterLoad = candleReqs.length;
  await p.waitForTimeout(3200);
  ok('Symbol change refreshes once by itself', candleReqs.length === afterLoad + 1, afterLoad + ' then ' + candleReqs.length + ' requests');

  await p.waitForTimeout(1200);
  ok('Prices still live', (await p.textContent('#connText')).trim() === 'live');
  await p.screenshot({ path: 'hist.png' });
  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  stopBridge();
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); stopBridge(); process.exit(1); });
