const {chromium}=require('playwright');const {spawn}=require('child_process');
const PORT=8020+Math.floor(Math.random()*60), BASE='http://localhost:'+PORT+'/';
const bridge=spawn(process.execPath,[__dirname+'/mock.js'],{env:Object.assign({},process.env,{PORT:String(PORT)}),stdio:'ignore'});
const stop=()=>{try{bridge.kill();}catch(e){}};process.on('exit',stop);
const R=[];const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));

// the structure block straight out of Ox Alpha, the commonest stateful Pine pattern
const PINE=`//@version=5
indicator("Structure", overlay=true)
swingLen = input.int(24, "Swing Length", minval=2)
emaLen   = input.int(50, "EMA", minval=1)
swingHi = ta.highest(high, swingLen)[1]
swingLo = ta.lowest(low, swingLen)[1]
var int structDir = 0
if close > swingHi
    structDir := 1
else if close < swingLo
    structDir := -1
basis = ta.ema(close, emaLen)
up = structDir == 1 and close > basis
dn = structDir == -1 and close < basis
plot(basis, "EMA")
plot(swingHi, "Swing high")
plotshape(up, title="Buy", style=shape.triangleup)
plotshape(dn, title="Sell", style=shape.triangledown)`;

(async()=>{
  await new Promise(r=>setTimeout(r,1500));
  const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:420,height:900},locale:'en-US'});
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{try{if(!localStorage.getItem('xm.key')){localStorage.setItem('xm.key','test-key-123');localStorage.setItem('xm.symbol','GOLD');localStorage.setItem('xm.tf','M5');}}catch(e){}});
  await p.goto(BASE);
  await p.waitForFunction(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none',null,{timeout:25000});
  await p.click('#indBtn');await p.waitForTimeout(300);await p.click('#indNew');await p.waitForTimeout(300);
  await p.fill('#edCode',PINE);
  await p.click('#edPine');await p.waitForTimeout(800);
  const js=await p.inputValue('#edCode'), notes=await p.textContent('#edMsg');
  console.log('--- converted ---\n'+js+'\n--- notes ---\n'+notes+'\n');
  ok('Pine inputs become settings',/input\(24, "Swing Length", \{ min: 2, int: true \}\)/.test(js),(js.split('\n').find(l=>/Swing Length/.test(l))||'').trim());
  ok('var + if/else becomes a loop over bars',/for \(let __i = 0; __i < n; __i\+\+\)/.test(js)&&/structDir\[__i\] =/.test(js),(js.split('\n').find(l=>/structDir\[__i\] =/.test(l))||'').trim().slice(0,80));
  ok('No note complaining about var or if',!/“var|“if/.test(notes),notes.replace(/\s+/g,' ').slice(0,90));
  await p.click('#edCheck');
  await p.waitForFunction(()=>/Works\.|not defined|is not|Stopped|Unexpected|Cannot/.test(document.getElementById('edMsg').textContent),null,{timeout:20000});
  const m=await p.textContent('#edMsg');
  ok('It runs and draws',/Works\. 2 lines \(EMA, Swing high\)/.test(m),m.replace(/\s+/g,' ').slice(0,110));
  const marks=/(\d+) BUY and (\d+) SELL/.exec(m);
  ok('And marks candles',marks&&(+marks[1]+ +marks[2])>0,marks?marks[0]:'none');
  ok('Its settings are offered',/2 settings/.test(m)&&/Swing Length, EMA/.test(m),(m.match(/\d+ settings[^.]*/)||[''])[0]);
  await p.fill('#edName','Structure');
  await p.click('#edSave');await p.waitForTimeout(2500);
  await p.click('#indList [data-set]');
  await p.waitForFunction(()=>/Swing Length/.test(document.getElementById('setBody').textContent),null,{timeout:15000});
  const f=await p.$$eval('#setBody [data-val]',els=>els.map(e=>e.dataset.val));
  ok('Converted script gets a settings sheet',f.join(',')==='Swing Length,EMA',f.join(','));
  await p.fill('#setBody [data-val="EMA"]','10');
  await p.click('#setSave');await p.waitForTimeout(2000);
  ok('Changing a converted value sticks',await p.evaluate(()=>Number(JSON.parse(localStorage.getItem('xm.indicators'))[0].values.EMA))===10);
  await p.click('#indClose').catch(()=>{});
  await p.waitForTimeout(1200);
  ok('Chart still drawn',await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));
  ok('No JavaScript errors',errs.length===0,errs.slice(0,3).join(' | '));
  console.log(R.join('\n'));await b.close();stop();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);stop();process.exit(1);});
