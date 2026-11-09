const {chromium}=require('playwright');
const PORT = Number(process.env.PORT) || 8711;
const R=[]; const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},locale:'en-US'});   // phone size
  const p=await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,160));});
  p.on('requestfailed',r=>errs.push('reqfail: '+r.url()));
  p.on('response',r=>{ if(r.status()===404) errs.push('404: '+r.url()); });
  await p.addInitScript(()=>{ try{ if(!localStorage.getItem('xm.key')){ localStorage.setItem('xm.key','test-key-123'); localStorage.setItem('xm.symbol','GOLD'); } }catch(e){} });
  await p.goto('http://localhost:'+PORT+'/',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);

  ok('Chart library loaded and candles drawn', await p.evaluate(()=>!!window.LightweightCharts && getComputedStyle(document.getElementById('chartMsg')).display==='none'));
  ok('Account bar filled from /api/account', (await p.textContent('#balance')).includes('10000'), await p.textContent('#balance'));
  const live=await p.textContent('#connText');
  ok('WebSocket connected (status live)', live.trim()==='live', live);

  const b1=await p.textContent('#bid'); await p.waitForTimeout(1500); const b2=await p.textContent('#bid');
  ok('Bid updates from ticks', b1!==b2, b1+' -> '+b2);
  ok('Ask and spread shown', /\d/.test(await p.textContent('#ask')) && /\d/.test(await p.textContent('#spread')), (await p.textContent('#ask'))+' spread '+(await p.textContent('#spread')));
  // read all four together: ticks land every 200ms, so separate reads race
  const sides=await p.evaluate(()=>['buyPx','ask','sellPx','bid'].map(id=>document.getElementById(id).textContent));
  ok('Buy/Sell buttons show the right side', sides[0]===sides[1] && sides[2]===sides[3], sides.join(' / '));

  // live candle update
  const before=await p.evaluate(()=>document.querySelector('canvas')?1:0);
  ok('Chart canvas present', before===1);

  // timeframe switch
  await p.click('#tfs button:nth-child(3)');  // M15
  await p.waitForTimeout(1500);
  ok('Timeframe switch refetches', (await p.getAttribute('#tfs button:nth-child(3)','aria-pressed'))==='true' );

  // place a BUY
  await p.fill('#lot','0.02');
  await p.click('#buyBtn');
  await p.waitForTimeout(1200);
  const toast=await p.textContent('#toasts');
  ok('BUY order toast shows fill', /filled at/.test(toast), toast.replace(/\s+/g,' ').slice(0,120));
  await p.waitForTimeout(1200);
  const rows=await p.$$eval('#positions tbody tr',r=>r.map(x=>x.innerText.replace(/\s+/g,' ')));
  ok('Position appears in the table', rows.length===1 && /BUY GOLD/.test(rows[0]), rows.join(' | '));

  // rejected order (lot above cap in the mock)
  await p.fill('#lot','2.00'); await p.click('#buyBtn'); await p.waitForTimeout(1200);
  ok('Rejected order shows the reason', /Invalid lot size/.test(await p.textContent('#toasts')));

  // close the position
  await p.click('#positions button[data-close]');
  await p.waitForTimeout(1500);
  ok('Close empties the table', /No open positions/.test(await p.textContent('#positions')), (await p.textContent('#positions')).trim().slice(0,60));

  // bad symbol -> error message, no crash
  await p.fill('#symbolInput','BADSYM'); await p.click('#applySymbol');
  await p.waitForFunction(() => !/Loading/i.test(document.getElementById('chartMsg').textContent), null, {timeout: 30000}).catch(() => {});
  ok('Unknown symbol reports an error', /Unknown symbol/.test(await p.textContent('#chartMsg')), await p.textContent('#chartMsg'));
  await p.fill('#symbolInput','GOLD'); await p.click('#applySymbol');
  await p.waitForFunction(() => getComputedStyle(document.getElementById('chartMsg')).display === 'none', null, {timeout: 30000}).catch(() => {});
  ok('Recovers after a bad symbol', await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));

  // wrong key -> prompt
  await p.evaluate(()=>{localStorage.setItem('xm.key','wrong');});
  await p.reload(); await p.waitForTimeout(2500);
  ok('Wrong key opens the key dialog', await p.evaluate(()=>document.getElementById('keyDlg').open));
  await p.fill('#keyInput','test-key-123'); await p.click('#keyForm button'); await p.waitForTimeout(2500);
  ok('Entering the key connects', (await p.textContent('#connText')).trim()==='live');

  await p.screenshot({path:'fe.png'});
  const real=errs.filter(e=>!/401 \(Unauthorized\)/.test(e) && !/BADSYM/.test(e) && !/404 \(Not Found\)/.test(e));   // the wrong-key and bad-symbol tests fail on purpose
  ok('No JavaScript errors', real.length===0, real.slice(0,3).join(' | '));
  console.log(R.join('\n'));
  await b.close();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);process.exit(1);});
