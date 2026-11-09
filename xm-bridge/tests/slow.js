// Switching symbols: the stand-in bridge makes the first request for each symbol slow,
// the way MT5 does while it downloads that symbol's history.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
// Its own stand-in on its own port: this suite needs a terminal that has never fetched these
// symbols, so the simulated history download actually happens.
const PORT = 8800 + Math.floor(Math.random() * 180);
const BASE = 'http://localhost:' + PORT + '/';
const bridge = spawn(process.execPath, [__dirname + '/mock.js'], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
const stopBridge = () => { try { bridge.kill(); } catch (e) {} };
process.on('exit', stopBridge);
const R = [];
const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));

(async () => {
  await new Promise(r => setTimeout(r, 1500));   // let the stand-in come up
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = [], reqs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { if (r.url().includes('/api/candles')) reqs.push(r.url().split('?')[1]); });
  await p.addInitScript(() => {
    try {
      if (!localStorage.getItem('xm.key')) { localStorage.setItem('xm.key', 'test-key-123'); localStorage.setItem('xm.symbol', 'GOLD'); }
    } catch (e) {}
  });

  await p.goto(BASE);
  await p.waitForTimeout(3200);
  ok('First chart drew', await p.evaluate(() => getComputedStyle(document.getElementById('chartMsg')).display === 'none'));

  await p.fill('#symbolInput', 'EURUSD');
  await p.click('#applySymbol');
  await p.waitForTimeout(1700);
  const during = await p.textContent('#chartMsg');
  ok('Explains the wait on a new symbol', /downloading this symbol/.test(during), during.replace(/\s+/g, ' ').slice(0, 70));
  await p.waitForTimeout(1600);
  ok('Then draws it', await p.evaluate(() => getComputedStyle(document.getElementById('chartMsg')).display === 'none'));

  // Hammer the timeframe buttons: the last tap must be the one on screen.
  reqs.length = 0;
  await p.click('#tfs button:nth-child(1)');
  await p.click('#tfs button:nth-child(3)');
  await p.click('#tfs button:nth-child(6)');
  await p.waitForTimeout(4500);
  const shown = await p.evaluate(() => ({
    tf: [...document.querySelectorAll('#tfs button')].find(x => x.getAttribute('aria-pressed') === 'true').textContent,
    msg: getComputedStyle(document.getElementById('chartMsg')).display,
  }));
  ok('Fast taps settle on the last timeframe', shown.tf === 'D1' && shown.msg === 'none', JSON.stringify(shown) + ' requests=' + reqs.length);

  // A symbol already downloaded comes back quickly.
  const t0 = Date.now();
  await p.fill('#symbolInput', 'GOLD');
  await p.click('#applySymbol');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('chartMsg')).display === 'none', null, { timeout: 9000 });
  const ms = Date.now() - t0;
  ok('Second visit to a symbol is fast', ms < 900, ms + ' ms');

  await p.waitForTimeout(800);
  ok('Price feed reconnected after switching', (await p.textContent('#connText')).trim() === 'live');
  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  stopBridge();
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); stopBridge(); process.exit(1); });
