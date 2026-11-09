const {chromium}=require('playwright');const {spawn}=require('child_process');
const PORT=8200+Math.floor(Math.random()*30), BASE='http://localhost:'+PORT+'/';
const bridge=spawn(process.execPath,[__dirname+'/mock.js'],{env:Object.assign({},process.env,{PORT:String(PORT)}),stdio:'ignore'});
const stop=()=>{try{bridge.kill();}catch(e){}};process.on('exit',stop);
const R=[];const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
(async()=>{
  await new Promise(r=>setTimeout(r,1500));
  const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:420,height:900},locale:'en-US'});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{if(!localStorage.getItem('xm.key')){localStorage.setItem('xm.key','test-key-123');localStorage.setItem('xm.symbol','GOLD');localStorage.setItem('xm.tf','M5');}}catch(e){}});
  await p.goto(BASE);
  await p.waitForFunction(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none',null,{timeout:25000});
  await p.click('#indBtn');await p.waitForTimeout(300);await p.click('#indOx');
  await p.waitForFunction(()=>/Ox Alpha/.test(document.getElementById('indList').textContent),null,{timeout:10000});
  await p.waitForTimeout(2500);
  const listed=await p.textContent('#indList');
  ok('Installs and runs clean',!/is not defined|Stopped|Cannot|undefined/.test(listed),listed.replace(/\s+/g,' ').slice(0,80));

  await p.click('#indList [data-edit]');await p.waitForTimeout(400);
  const read=async()=>{await p.click('#edCheck');
    await p.waitForFunction(()=>/Works\.|not defined|is not|Stopped|Cannot/.test(document.getElementById('edMsg').textContent),null,{timeout:20000});
    return p.textContent('#edMsg');};
  const m30=await read();
  ok('UT timeframe is a setting',/UT timeframe \(minutes/.test(m30),(m30.match(/settings for the Settings sheet: [^.]*/)||[''])[0].slice(0,90));
  const n30=+(/(\d+) BUY/.exec(m30)||[0,0])[1] + +(/and (\d+) SELL/.exec(m30)||[0,0])[1];
  await p.click('#edClose');await p.waitForTimeout(300);

  // same script on the chart timeframe: far more flips, so more signals
  await p.click('#indList [data-set]');
  await p.waitForFunction(()=>/UT timeframe/.test(document.getElementById('setBody').textContent),null,{timeout:15000});
  await p.fill('#setBody [data-val="UT timeframe (minutes, 0 = chart)"]','0');
  await p.click('#setSave');await p.waitForTimeout(2500);
  await p.click('#indList [data-edit]');await p.waitForTimeout(400);
  const m5=await read();
  const n5=+(/(\d+) BUY/.exec(m5)||[0,0])[1] + +(/and (\d+) SELL/.exec(m5)||[0,0])[1];
  ok('30-minute UT gives fewer signals than the 5-minute chart',n30<n5&&n30>0,'30m: '+n30+' signals, chart: '+n5);
  await p.click('#edClose');await p.waitForTimeout(300);

  // put it back and confirm the setting round-trips
  await p.click('#indList [data-set]');
  await p.waitForFunction(()=>/UT timeframe/.test(document.getElementById('setBody').textContent),null,{timeout:15000});
  await p.fill('#setBody [data-val="UT timeframe (minutes, 0 = chart)"]','30');
  await p.click('#setSave');await p.waitForTimeout(2000);
  await p.click('#indList [data-edit]');await p.waitForTimeout(400);
  const back=await read();
  const nb=+(/(\d+) BUY/.exec(back)||[0,0])[1] + +(/and (\d+) SELL/.exec(back)||[0,0])[1];
  ok('Back to 30 minutes gives the first answer again',nb===n30,nb+' vs '+n30);
  await p.click('#edClose');await p.click('#indClose');await p.waitForTimeout(1500);
  ok('Chart fine',await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));
  ok('No JavaScript errors',errs.length===0,errs.slice(0,3).join(' | '));
  console.log(R.join('\n'));await b.close();stop();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);stop();process.exit(1);});
