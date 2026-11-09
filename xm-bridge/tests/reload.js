// The reported state: an indicator already saved, then the page opened fresh.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const PORT = 8300 + Math.floor(Math.random() * 180);
const BASE = 'http://localhost:' + PORT + '/';
const bridge = spawn(process.execPath, [__dirname + '/mock.js'], { env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore' });
const stopBridge = () => { try { bridge.kill(); } catch (e) {} };
process.on('exit', stopBridge);

const R = [];
const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));

// what the editor saves after converting the EMA-cross Pine script
const CONVERTED = `// Converted from Pine Script. Check every line before you trade on it.
let fastLen = (9);
let slowLen = (21);
const __s0 = ta.ema(bars.close, fastLen);
let fast = __s0;
const __s1 = ta.ema(bars.close, slowLen);
let slow = __s1;
const __s2 = ta.crossover(fast, slow);
let buySig = __s2;
const __s3 = ta.crossunder(fast, slow);
let sellSig = __s3;

return {
  plots: { "Fast EMA": fast, "Slow EMA": slow },
  buy: buySig,
  sell: sellSig
};`;

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'Asia/Kolkata' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
  await p.addInitScript(code => {
    try {   // seed once: a reload must keep whatever the page and the test stored
      if (!localStorage.getItem('xm.key')) {
        localStorage.setItem('xm.key', 'test-key-123');
        localStorage.setItem('xm.symbol', 'GOLD');
        localStorage.setItem('xm.tf', 'M5');
        localStorage.setItem('xm.indicators', JSON.stringify([{ id: 'abc', name: 'EMA Cross', code: code, on: true }]));
      }
    } catch (e) {}
  }, CONVERTED);

  await p.goto(BASE);
  await p.waitForTimeout(6000);

  const st = await p.evaluate(() => ({
    msg: document.getElementById('chartMsg').textContent.trim().slice(0, 80),
    hidden: getComputedStyle(document.getElementById('chartMsg')).display === 'none',
    canvases: document.querySelectorAll('#chart canvas').length,
    strip: document.getElementById('strip').textContent.slice(0, 60),
    conn: document.getElementById('connText').textContent.trim(),
  }));
  ok('Chart drew with a saved indicator on', st.hidden && st.canvases > 0, JSON.stringify(st));
  ok('Candle count still reported', /candles/.test(st.strip), st.strip);

  // the sheet must list it
  await p.click('#indBtn');
  await p.waitForTimeout(600);
  const list = await p.textContent('#indList');
  ok('Indicators sheet lists the saved script', /EMA Cross/.test(list) && !/error/.test(list), list.replace(/\s+/g, ' ').slice(0, 80));
  const checked = await p.isChecked('#indList input[type=checkbox]');
  ok('And shows it switched on', checked === true);

  // open the editor on it
  await p.click('#indList [data-edit]');
  await p.waitForTimeout(500);
  ok('Editor opens with the saved code', (await p.inputValue('#edCode')).includes('ta.ema(bars.close, fastLen)'));
  await p.click('#edCheck');
  await p.waitForFunction(() => /Works\.|not defined|is not|Stopped/.test(document.getElementById('edMsg').textContent), null, { timeout: 15000 });
  const msg = await p.textContent('#edMsg');
  ok('Saved script still runs', /Works\./.test(msg), msg.replace(/\s+/g, ' ').slice(0, 90));
  await p.click('#edClose');
  await p.click('#indClose');
  await p.waitForTimeout(1500);

  // and the chart is still there afterwards
  const after = await p.evaluate(() => ({
    hidden: getComputedStyle(document.getElementById('chartMsg')).display === 'none',
    canvases: document.querySelectorAll('#chart canvas').length,
  }));
  ok('Chart still drawn after opening the sheets', after.hidden && after.canvases > 0, JSON.stringify(after));

  // switching timeframe with an indicator on
  await p.click('#tfs button:nth-child(4)');
  await p.waitForTimeout(4000);
  const tf = await p.evaluate(() => ({
    hidden: getComputedStyle(document.getElementById('chartMsg')).display === 'none',
    msg: document.getElementById('chartMsg').textContent.trim().slice(0, 60),
  }));
  ok('Chart survives a timeframe change with an indicator on', tf.hidden, JSON.stringify(tf));

  // a script that breaks must not take the chart with it
  await p.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('xm.indicators'));
    list.push({ id: 'bad', name: 'Broken one', code: 'return { plots: { x: oops } };', on: true });
    localStorage.setItem('xm.indicators', JSON.stringify(list));
  });
  await p.reload();
  // the toast clears itself after four seconds, so look while it is still up
  await p.waitForFunction(() => /Broken one/.test(document.getElementById('toasts').textContent), null, { timeout: 12000 }).catch(() => {});
  const toastText = await p.textContent('#toasts');
  await p.waitForTimeout(2500);
  const broken = await p.evaluate(() => ({
    hidden: getComputedStyle(document.getElementById('chartMsg')).display === 'none',
    canvases: document.querySelectorAll('#chart canvas').length,
  }));
  ok('A broken indicator does not blank the chart', broken.hidden && broken.canvases > 0, JSON.stringify(broken));
  ok('And it says which one broke', /Broken one/.test(toastText), toastText.replace(/\s+/g, ' ').slice(0, 80));
  await p.click('#indBtn');
  await p.waitForTimeout(500);
  ok('The list shows the reason', /oops is not defined/.test(await p.textContent('#indList')), (await p.textContent('#indList')).replace(/\s+/g, ' ').slice(0, 90));
  await p.click('#indClose');

  await p.screenshot({ path: 'reload.png' });
  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 4).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  stopBridge();
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); stopBridge(); process.exit(1); });
