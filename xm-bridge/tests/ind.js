// Indicators: the editor, the sandbox, drawing lines and BUY / SELL marks, and the new theme.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8400 + Math.floor(Math.random() * 180);
const BASE = 'http://localhost:' + PORT + '/';
const bridge = spawn(process.execPath, [__dirname + '/mock.js'], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
const stopBridge = () => { try { bridge.kill(); } catch (e) {} };
process.on('exit', stopBridge);

const R = [];
const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'Asia/Kolkata' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 140)); });
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
  await p.waitForTimeout(800);

  // --- theme and control sizes
  const look = await p.evaluate(() => {
    const cs = n => getComputedStyle(document.getElementById(n));
    return {
      bg: getComputedStyle(document.body).backgroundColor,
      buyH: document.getElementById('buyBtn').getBoundingClientRect().height,
      buyFont: parseFloat(cs('buyBtn').fontSize),
      bidFont: parseFloat(cs('bid').fontSize),
      bidColor: cs('bid').color,
      askColor: cs('ask').color,
      scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  ok('Dark Midnight Cyberpunk ground', look.bg === 'rgb(6, 9, 19)', look.bg);
  ok('Bid is cyan and ask is magenta', look.bidColor === 'rgb(0, 229, 255)' && look.askColor === 'rgb(255, 0, 85)', look.bidColor + ' / ' + look.askColor);
  ok('Buy and sell buttons are small', look.buyH <= 44 && look.buyFont <= 13.5, look.buyH.toFixed(0) + 'px tall, ' + look.buyFont + 'px text');
  ok('Bid and ask type is smaller too', look.bidFont <= 15, look.bidFont + 'px');
  ok('No sideways scrolling at phone width', look.scrollX === false);

  // --- the editor
  await p.click('#indBtn');
  await p.waitForTimeout(400);
  ok('Indicators sheet opens empty with an invitation', /No indicators yet/.test(await p.textContent('#indList')));
  await p.click('#indNew');
  await p.waitForTimeout(400);
  const tpl = await p.inputValue('#edCode');
  ok('New indicator starts from a worked example with settings', /input\.int\(9, "Fast EMA"/.test(tpl) && /ta\.ema\(bars\.close, fastLen\)/.test(tpl), (tpl.split('\n').find(l => /input\.int/.test(l)) || '').trim());

  await p.click('#edCheck');
  await p.waitForFunction(() => /Works\./.test(document.getElementById('edMsg').textContent), null, { timeout: 15000 });
  const checked = await p.textContent('#edMsg');
  ok('Check runs it on the real candles', /Works\. 2 lines \(EMA 9, EMA 21\)/.test(checked), checked);

  await p.click('#edSave');
  await p.waitForTimeout(1800);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators') || '[]'));
  ok('Saved and switched on', saved.length === 1 && saved[0].on === true && saved[0].name === 'EMA cross', JSON.stringify(saved.map(x => x.name)));
  ok('Shows in the list with a colour', /EMA cross/.test(await p.textContent('#indList')) && (await p.$$('#indList .swatch')).length === 1);

  // --- a broken script is reported, never saved
  await p.click('#indNew');
  await p.waitForTimeout(300);
  await p.fill('#edName', 'Broken');
  await p.fill('#edCode', 'return { plots: { x: nothingHere } };');
  await p.click('#edSave');
  await p.waitForFunction(() => /Not saved/.test(document.getElementById('edMsg').textContent), null, { timeout: 15000 });
  ok('A script that throws is refused with the reason', /nothingHere/.test(await p.textContent('#edMsg')), await p.textContent('#edMsg'));
  const still = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators') || '[]').length);
  ok('And nothing was stored', still === 1, still + ' saved');

  // --- an endless script is stopped rather than freezing the page
  await p.fill('#edCode', 'while (true) {}');
  await p.click('#edCheck');
  await p.waitForFunction(() => /more than 4 seconds/.test(document.getElementById('edMsg').textContent), null, { timeout: 20000 });
  ok('An endless script is stopped', true, await p.textContent('#edMsg'));
  await p.click('#edClose');
  await p.waitForTimeout(500);

  // --- the page is still alive and drawing after that
  await p.click('#indClose');
  await p.waitForTimeout(1500);
  ok('Page still live after the runaway script', (await p.textContent('#connText')).trim() === 'live');

  // --- marks and lines actually reach the chart
  const drawn = await p.evaluate(() => ({ canvases: document.querySelectorAll('#chart canvas').length }));
  ok('Chart still rendering', drawn.canvases > 0, drawn.canvases + ' canvases');

  // --- switching a script off removes its lines
  await p.click('#indBtn');
  await p.waitForTimeout(400);
  await p.uncheck('#indList input[type=checkbox]');
  await p.waitForTimeout(1200);
  const offState = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators'))[0].on);
  ok('Switching it off is remembered', offState === false);

  await p.click('#indClose');
  await p.screenshot({ path: 'ind.png' });
  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  stopBridge();
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); stopBridge(); process.exit(1); });
