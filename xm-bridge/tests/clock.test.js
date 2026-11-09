// The status strip's clock switch: broker time (what the MT5 terminal shows) vs this device's time.
const {chromium} = require('playwright');
const PORT = Number(process.env.PORT) || 8799;
const R = []; const ok = (n, c, d) => R.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' — ' + d : ''));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport: {width: 1280, height: 800}, locale: 'en-US'});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('xm.key', 'test-key-123'));
  await p.goto('http://localhost:' + PORT + '/', {waitUntil: 'domcontentloaded'});
  await p.waitForFunction(() => document.getElementById('strip').textContent.includes('candles'), null, {timeout: 60000});

  const strip = () => p.textContent('#strip');
  const firstTime = () => p.evaluate(() => window.__xmState ? null : null);

  ok('Opens on this device\'s clock', /times on your clock \(UTC/.test(await strip()), (await strip()).slice(-40));
  ok('No buttons in the strip', (await p.$$('#strip button')).length === 0);
  ok('The clock label is the switch', (await p.$$('#strip .clockpick')).length === 1);

  // the mock broker runs UTC+3, so the two clocks must differ
  await p.click('#strip .clockpick'); await p.waitForTimeout(700);
  ok('Switches to the broker clock', /times on the broker clock \(UTC\+3\)/.test(await strip()), (await strip()).slice(-44));

  ok('Candles are still drawn', await p.evaluate(() => document.querySelectorAll('#chart canvas').length > 0));

  await p.click('#strip .clockpick'); await p.waitForTimeout(700);
  ok('And back to this device\'s clock', /times on your clock \(UTC/.test(await strip()), (await strip()).slice(-40));

  await p.click('#strip .clockpick'); await p.waitForTimeout(500);
  await p.reload();
  await p.waitForFunction(() => document.getElementById('strip').textContent.includes('candles'), null, {timeout: 60000});
  ok('The choice survives a reload', /broker clock/.test(await strip()), (await strip()).slice(-44));

  ok('No JavaScript errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
  process.exit(R.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(R.join('\n')); console.log('CRASH ' + e.message); process.exit(1); });
