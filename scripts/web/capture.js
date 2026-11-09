// Records every data response the app makes while browsing all tabs, for the web snapshot.
// Usage: node capture.js <assets dir> <out file>
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [assets, out] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-web-security', '--allow-file-access-from-files'] });
  const p = await b.newPage({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7; wv) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36', viewport: { width: 393, height: 820 } });
  const map = {}, pending = [];
  const key = u => { const x = new URL(u); return ((/finance\.yahoo\.com$/.test(x.host) ? 'yahoo' : x.host) + x.pathname + x.search).replace(/when%3A\w+/gi, '').replace(/[?&]_=\d+/, ''); };
  p.on('response', r => {
    const t = r.request().resourceType();
    if((t === 'fetch' || t === 'xhr') && r.status() === 200 && /^https?:/.test(r.url()))
      pending.push(r.text().then(body => { map[key(r.url())] = body; }).catch(() => {}));
  });
  await p.addInitScript(() => { try { localStorage.setItem('cot.welcome.skipped', 'true'); } catch(e){} });
  await p.goto('file://' + assets + '/index.html');
  await p.waitForTimeout(6000);
  const frame = async (tab, sel) => { await p.click('.tabbtn[data-tab=' + tab + ']'); return (await p.waitForSelector(sel, { state:'attached' })).contentFrame(); };
  const news = await (await p.waitForSelector('#viewNews iframe', { state:'attached' })).contentFrame();
  await news.waitForFunction(() => window.NewsEngine && NewsEngine.State.lastNewsAt > 0, null, { timeout:150000 });
  // history queries the News tab offers
  for(const sym of ['DX-Y.NYB', '^TNX', 'CL=F', 'ES=F', 'SI=F', 'BTC-USD', 'GC=F']){
    await news.evaluate(s => { document.getElementById('qSym').value = s; document.getElementById('qSym').dispatchEvent(new Event('change')); document.getElementById('qRun').click(); }, sym);
    await news.waitForFunction(() => !/Loading/.test(document.getElementById('qOut').textContent), null, { timeout:60000 }).catch(() => {});
  }
  const charts = await frame('charts', '#viewCharts iframe');
  await charts.waitForFunction(() => window.ChartAPI && ChartAPI.state().candles.length > 60, null, { timeout:90000 });
  for(const [t, n] of [['SI=F','Silver'],['CL=F','Crude Oil'],['ES=F','S&P 500'],['NQ=F','Nasdaq'],['HG=F','Copper'],['NG=F','Nat Gas'],['BTC-USD','Bitcoin'],['GC=F','Gold']])
    await charts.evaluate(([t, n]) => ChartAPI.openMarket(t, n).catch(() => {}), [t, n]);
  const scanner = await frame('scanner', '#viewScanner iframe');
  await scanner.waitForFunction(() => document.querySelectorAll('.group').length > 0, null, { timeout:150000 }).catch(() => {});
  await p.waitForTimeout(3000);
  await Promise.all(pending);
  fs.writeFileSync(out, 'window.__SNAP=' + JSON.stringify({ at:new Date().toISOString(), map }) + ';\n');
  console.log('recorded', Object.keys(map).length, 'responses,', (fs.statSync(out).size / 1e6).toFixed(1), 'MB');
  await b.close();
})();
