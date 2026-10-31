const {chromium}=require('playwright');
const R=[];const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
const covered=p=>p.evaluate(()=>{const f=document.querySelector('.tv-frame');if(!f)return false;
  const r=f.getBoundingClientRect(),c=document.querySelector('.chart-wrap').getBoundingClientRect();
  return r.width>=c.width-2&&r.height>=c.height-2;});
(async()=>{
  const b=await chromium.launch({args:['--disable-web-security','--allow-file-access-from-files']});
  const p=await b.newPage({viewport:{width:412,height:860},locale:'en-US'});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto('file://'+(process.env.REPO||'/home/user/rajareddy')+'/cot-widget-android/app/src/main/assets/charts/charts.html');
  await p.waitForFunction(()=>window.ChartAPI&&ChartAPI.state().candles.length>60,null,{timeout:60000});
  await p.waitForTimeout(2500);
  ok('Opens on the broker page',await covered(p));
  ok('Button offers the app chart',(await p.textContent('#tvBtn')).trim()==='CHART',await p.textContent('#tvBtn'));
  ok('Button is visible again',await p.isVisible('#tvBtn'));

  await p.click('#tvBtn');await p.waitForTimeout(900);
  ok('Tapping it shows the app chart',!(await covered(p)));
  ok('Button now offers the broker page',(await p.textContent('#tvBtn')).trim()==='XM',await p.textContent('#tvBtn'));
  ok('Candles are on screen',await p.evaluate(()=>document.querySelectorAll('#chart canvas').length>0));

  await p.click('#tvBtn');await p.waitForTimeout(900);
  ok('And back to the broker page',await covered(p));

  // the reported problem: tapping a market in Scanner or Markets
  await p.evaluate(()=>window.postMessage({type:'openMarket',ticker:'SI=F',name:'Silver'},'*'));
  await p.waitForTimeout(6000);
  const s=await p.evaluate(()=>({m:document.getElementById('src').textContent,btn:document.getElementById('tvBtn').textContent}));
  ok('Opening a market from Scanner shows that chart',!(await covered(p))&&/Silver/.test(s.m),JSON.stringify(s));

  // back button returns to the broker page rather than leaving the tab
  await p.click('#tvBtn');await p.waitForTimeout(700);
  const handled=await p.evaluate(()=>window.appBack());
  await p.waitForTimeout(700);
  ok('Back leaves the broker page first',handled===true&&!(await covered(p)));

  await p.reload();
  await p.waitForFunction(()=>window.ChartAPI&&ChartAPI.state().candles.length>60,null,{timeout:60000});
  await p.waitForTimeout(2500);
  ok('The choice survives a restart',!(await covered(p)),'app chart still showing');
  ok('No JavaScript errors',errs.length===0,errs.slice(0,3).join(' | '));
  await p.screenshot({path:'toggle.png'});
  console.log(R.join('\n'));await b.close();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);process.exit(1);});
