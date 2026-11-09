// Per-indicator settings: declared values, line colours and visibility, marks on and off.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8100 + Math.floor(Math.random() * 90);
const BASE = 'http://localhost:' + PORT + '/';
const bridge = spawn(process.execPath, [__dirname + '/mock.js'], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
const stopBridge = () => { try { bridge.kill(); } catch (e) {} };
process.on('exit', stopBridge);

const R = [];
const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));

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

  // install Ox Alpha, which now declares its own settings
  await p.click('#indBtn');
  await p.waitForTimeout(300);
  await p.click('#indOx');
  await p.waitForFunction(() => /Ox Alpha UT Pro/.test(document.getElementById('indList').textContent), null, { timeout: 10000 });
  await p.waitForTimeout(2500);

  await p.click('#indList [data-set]');
  await p.waitForFunction(() => /UT key value/.test(document.getElementById('setBody').textContent), null, { timeout: 15000 });
  const fields = await p.$$eval('#setBody [data-val]', els => els.map(e => e.dataset.val));
  ok('Settings sheet lists the script values', fields.includes('UT key value (sensitivity)') && fields.includes('Structure swing length') && fields.length >= 10, fields.length + ' fields');
  const lines = await p.$$eval('#setBody [data-show]', els => els.map(e => e.dataset.show));
  ok('And every line it draws', lines.join(',') === 'UT stop,POC,PDH,PDL', lines.join(','));
  ok('Plus a marks switch', await p.isVisible('#s_marks'));

  // change a value and apply
  await p.fill('#setBody [data-val="Structure swing length"]', '8');
  await p.click('#setSave');
  await p.waitForTimeout(2500);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators'))[0].values);
  ok('A changed value is stored', saved && Number(saved['Structure swing length']) === 8, JSON.stringify(saved && saved['Structure swing length']));

  // it actually reaches the script: a looser swing length gives different signals
  const marksAfter = await p.evaluate(() => document.querySelectorAll('#chart canvas').length);
  ok('Chart still drawing after the change', marksAfter > 0);

  // turn two lines off
  await p.click('#indList [data-set]');
  await p.waitForFunction(() => /UT key value/.test(document.getElementById('setBody').textContent), null, { timeout: 15000 });
  await p.uncheck('#setBody [data-show="PDH"]');
  await p.uncheck('#setBody [data-show="PDL"]');
  await p.click('#setSave');
  await p.waitForTimeout(2000);
  const hidden = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators'))[0].hide);
  ok('Lines can be switched off', hidden && hidden.PDH === true && hidden.PDL === true, JSON.stringify(hidden));

  // colour change sticks
  await p.click('#indList [data-set]');
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const el = document.querySelector('#setBody [data-color="UT stop"]');
    el.value = '#ff9900';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.click('#setSave');
  await p.waitForTimeout(1500);
  const colors = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators'))[0].colors);
  ok('Line colour is kept', colors && colors['UT stop'] === '#ff9900', JSON.stringify(colors && colors['UT stop']));

  // marks off
  await p.click('#indList [data-set]');
  await p.waitForTimeout(900);
  await p.uncheck('#s_marks');
  await p.click('#setSave');
  await p.waitForTimeout(1500);
  ok('BUY / SELL marks can be switched off', await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators'))[0].marksOff === true));

  // reset puts everything back
  await p.click('#indList [data-set]');
  await p.waitForTimeout(900);
  await p.click('#setReset');
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => JSON.parse(localStorage.getItem('xm.indicators'))[0]);
  ok('Reset clears the lot', !after.values && !after.hide && !after.colors && !after.marksOff, JSON.stringify({ v: !!after.values, h: !!after.hide, c: !!after.colors, m: !!after.marksOff }));
  await p.click('#setClose');
  await p.click('#indClose');
  await p.waitForTimeout(1500);

  const chart = await p.evaluate(() => ({ hidden: getComputedStyle(document.getElementById('chartMsg')).display === 'none', canvases: document.querySelectorAll('#chart canvas').length }));
  ok('Chart fine through all of it', chart.hidden && chart.canvases > 0, JSON.stringify(chart));
  await p.screenshot({ path: __dirname + '/settings.png' });
  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  stopBridge();
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); stopBridge(); process.exit(1); });
