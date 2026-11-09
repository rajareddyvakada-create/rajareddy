const {chromium}=require('playwright');
const R=[];const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
(async()=>{
  const b=await chromium.launch({args:['--disable-web-security','--allow-file-access-from-files']});
  const p=await b.newPage({viewport:{width:412,height:860},locale:'en-US'});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+(process.env.REPO||'/home/user/rajareddy')+'/cot-widget-android/app/src/main/assets/charts/charts.html');
  await p.waitForFunction(()=>window.ChartAPI&&ChartAPI.state().candles.length>60,null,{timeout:60000});
  await p.waitForTimeout(2500);
  ok('Starts on the MT5 terminal',/web\.metatrader\.app/.test(await p.evaluate(()=>(document.querySelector('.tv-frame')||{}).src||'')));

  await p.evaluate(()=>document.getElementById('dataDlg').showModal());
  await p.waitForTimeout(300);
  ok('Bridge address field is there',await p.isVisible('#bridgeUrl'));
  // empty address is refused
  await p.click('#bridgeOpen');await p.waitForTimeout(400);
  ok('Empty address is refused with advice',/Type the address/.test(await p.textContent('#noticeBody')),(await p.textContent('#noticeBody')).slice(0,60));

  await p.evaluate(()=>document.getElementById('dataDlg').showModal());
  await p.fill('#bridgeUrl','192.168.1.20:8000');
  await p.click('#bridgeOpen');await p.waitForTimeout(900);
  const r=await p.evaluate(()=>({src:(document.querySelector('.tv-frame')||{}).src||'',btn:document.getElementById('tvBtn').textContent,saved:JSON.parse(localStorage.getItem('chart.bridge-url'))}));
  ok('Bridge becomes the chart',/^http:\/\/192\.168\.1\.20:8000/.test(r.src),r.src);
  ok('Button offers the app chart while the bridge shows',r.btn==='CHART',r.btn);
  await p.click('#tvBtn');await p.waitForTimeout(600);
  ok('Button then names the PC bridge',(await p.textContent('#tvBtn')).trim()==='PC',await p.textContent('#tvBtn'));
  await p.click('#tvBtn');await p.waitForTimeout(600);
  ok('Address is remembered',r.saved==='192.168.1.20:8000',String(r.saved));

  await p.reload();
  await p.waitForFunction(()=>window.ChartAPI&&ChartAPI.state().candles.length>60,null,{timeout:60000});
  await p.waitForTimeout(2500);
  ok('Still on the bridge after a restart',/192\.168\.1\.20:8000/.test(await p.evaluate(()=>(document.querySelector('.tv-frame')||{}).src||'')));

  await p.evaluate(()=>document.getElementById('dataDlg').showModal());
  await p.click('#bridgeOff');await p.waitForTimeout(900);
  ok('Back to the MT5 terminal',/web\.metatrader\.app/.test(await p.evaluate(()=>(document.querySelector('.tv-frame')||{}).src||'')));
  ok('No JavaScript errors',errs.length===0,errs.slice(0,3).join(' | '));
  console.log(R.join('\n'));await b.close();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);process.exit(1);});
