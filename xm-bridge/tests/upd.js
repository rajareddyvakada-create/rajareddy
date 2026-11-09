const {chromium}=require('playwright');const {spawn}=require('child_process');
const PORT=8240+Math.floor(Math.random()*30), BASE='http://localhost:'+PORT+'/';
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
  await p.waitForTimeout(800);
  ok('Update button is in the toolbar',await p.isVisible('#updBtn'));

  // nothing newer yet
  await p.click('#updBtn');
  await p.waitForFunction(()=>/newest version/.test(document.getElementById('toasts').textContent),null,{timeout:10000}).catch(()=>{});
  ok('Says when there is nothing to do',/already the newest/.test(await p.textContent('#toasts')),(await p.textContent('#toasts')).replace(/\s+/g,' ').slice(0,60));
  await p.waitForTimeout(4200);

  // arm a newer version; the quiet check on load should notice it
  await p.evaluate(u=>fetch(u+'api/update-arm',{headers:{'X-API-Key':'test-key-123'}}),BASE);
  await p.reload();
  await p.waitForFunction(()=>document.getElementById('updBtn').classList.contains('ready'),null,{timeout:20000});
  ok('Notices a newer version by itself',(await p.textContent('#updBtn')).trim()==='Update ready',await p.textContent('#updBtn'));
  const t=await p.textContent('#toasts');
  ok('And says so',/newer version/.test(t),t.replace(/\s+/g,' ').slice(0,70));

  // applying it reloads the page
  const nav=p.waitForNavigation({timeout:15000}).catch(()=>null);
  await p.click('#updBtn');
  await nav;
  await p.waitForFunction(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none',null,{timeout:25000});
  ok('Applying it reloads into a working page',await p.evaluate(()=>document.querySelectorAll('#chart canvas').length>0));
  ok('No JavaScript errors',errs.length===0,errs.slice(0,3).join(' | '));
  console.log(R.join('\n'));await b.close();stop();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);stop();process.exit(1);});
