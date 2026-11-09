const {chromium}=require('playwright');const {spawn}=require('child_process');
const PORT=8160+Math.floor(Math.random()*30), BASE='http://localhost:'+PORT+'/';
const bridge=spawn(process.execPath,[__dirname+'/mock.js'],{env:Object.assign({},process.env,{PORT:String(PORT)}),stdio:'ignore'});
const stop=()=>{try{bridge.kill();}catch(e){}};process.on('exit',stop);
const R=[];const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
const SCRIPT=`const len = input.int(5, "Length", { min: 1 });
const ma = ta.sma(bars.close, len);
return { plots: { "MA": ma }, buy: ta.crossover(bars.close, ma), sell: ta.crossunder(bars.close, ma) };`;
(async()=>{
  await new Promise(r=>setTimeout(r,1500));
  const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:420,height:900},locale:'en-US'});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{if(!localStorage.getItem('xm.key')){localStorage.setItem('xm.key','test-key-123');localStorage.setItem('xm.symbol','GOLD');localStorage.setItem('xm.tf','M5');}}catch(e){}});
  await p.goto(BASE);
  await p.waitForFunction(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none',null,{timeout:25000});
  await p.click('#indBtn');await p.waitForTimeout(300);await p.click('#indNew');await p.waitForTimeout(300);
  await p.fill('#edName','MA test');await p.fill('#edCode',SCRIPT);
  await p.click('#edCheck');
  await p.waitForFunction(()=>/Works\./.test(document.getElementById('edMsg').textContent),null,{timeout:15000});
  const m1=await p.textContent('#edMsg');
  const c1=+(/(\d+) BUY/.exec(m1)||[0,0])[1];
  await p.click('#edSave');await p.waitForTimeout(2000);

  // change Length 5 -> 60 and apply
  await p.click('#indList [data-set]');
  await p.waitForFunction(()=>/Length/.test(document.getElementById('setBody').textContent),null,{timeout:15000});
  await p.fill('#setBody [data-val="Length"]','60');
  await p.click('#setSave');await p.waitForTimeout(2500);

  // read it back through the editor's Check, which uses the saved values
  await p.click('#indList [data-edit]');await p.waitForTimeout(500);
  await p.click('#edCheck');
  await p.waitForFunction(()=>/Works\./.test(document.getElementById('edMsg').textContent),null,{timeout:15000});
  const m2=await p.textContent('#edMsg');
  const c2=+(/(\d+) BUY/.exec(m2)||[0,0])[1];
  ok('A changed setting changes the result', c1>0 && c2>0 && c1!==c2, 'length 5 gave '+c1+' BUY, length 60 gave '+c2);
  await p.click('#edClose');await p.waitForTimeout(300);

  // and the field still shows 60 when reopened
  await p.click('#indList [data-set]');
  await p.waitForFunction(()=>/Length/.test(document.getElementById('setBody').textContent),null,{timeout:15000});
  ok('The sheet reopens on the saved value', (await p.inputValue('#setBody [data-val="Length"]'))==='60', await p.inputValue('#setBody [data-val="Length"]'));
  await p.click('#setClose');await p.click('#indClose');await p.waitForTimeout(1200);
  ok('Chart fine',await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));
  ok('No JavaScript errors',errs.length===0,errs.slice(0,3).join(' | '));
  console.log(R.join('\n'));await b.close();stop();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);stop();process.exit(1);});
