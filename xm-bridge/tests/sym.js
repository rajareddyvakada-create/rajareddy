const {chromium}=require('playwright');
const PORT = Number(process.env.PORT) || 8711;
const R=[]; const ok=(n,c,d)=>R.push((c?'PASS ':'FAIL ')+n+(d?' — '+d:''));
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},locale:'en-US'});
  const p=await ctx.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,120));});
  await p.addInitScript(()=>{try{ if(!localStorage.getItem('xm.key')){localStorage.setItem('xm.key','test-key-123');localStorage.setItem('xm.symbol','XAUUSD');} }catch(e){}});
  await p.goto('http://localhost:'+PORT+'/');
  // The mock simulates MT5 downloading history, so wait for the page to settle rather than
  // guessing a delay: a fixed wait makes this suite fail only when the machine is busy.
  const settled = async () => {
    await p.waitForFunction(() => {
      const m = document.getElementById('chartMsg');
      if (getComputedStyle(m).display === 'none') return true;
      return !/downloading|Loading/i.test(m.textContent);
    }, null, {timeout: 30000});
  };
  await p.waitForTimeout(4500);

  // the saved XAUUSD does not exist on this account, exactly like the user's case
  const sym=await p.inputValue('#symbolInput');
  ok('Falls back to a symbol the account really has', sym==='GOLD', 'symbol box shows '+sym);
  ok('Chart drew after the fallback', await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));
  ok('Told the user why', /No symbol called XAUUSD/.test(await p.textContent('#toasts')), (await p.textContent('#toasts')).replace(/\s+/g,' ').slice(0,90));

  // picker
  await p.click('#pickSymbol'); await p.waitForTimeout(900);
  const rows=await p.$$eval('.sym-row',r=>r.map(x=>x.innerText.replace(/\s+/g,' ')));
  ok('Browse lists the account symbols', rows.length===3 && /GOLD/.test(rows[0]), rows.join(' | '));
  await p.fill('#symSearch','silver'); await p.waitForTimeout(900);
  const found=await p.$$eval('.sym-row',r=>r.map(x=>x.innerText.replace(/\s+/g,' ')));
  ok('Search reaches symbols outside Market Watch', found.length===1 && /XAGUSD/.test(found[0]), found.join(' | '));
  await p.click('.sym-row'); await settled();
  ok('Picking one loads its chart', (await p.inputValue('#symbolInput'))==='XAGUSD' && await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));

  // mixed-case name must not be upper-cased
  await p.fill('#symbolInput','US30Cash'); await p.click('#applySymbol'); await settled();
  ok('Mixed-case names kept as typed', (await p.inputValue('#symbolInput'))==='US30Cash' && await p.evaluate(()=>getComputedStyle(document.getElementById('chartMsg')).display==='none'));

  // a genuinely unknown name still explains itself
  await p.fill('#symbolInput','NOPE'); await p.click('#applySymbol'); await settled();
  const msg=await p.textContent('#chartMsg');
  ok('Unknown name is reported, not silently swapped', /Unknown symbol/.test(msg) && /GOLD/.test(msg) && (await p.inputValue('#symbolInput'))==='NOPE', msg.replace(/\s+/g,' ').slice(0,120));

  await p.screenshot({path:'sym.png'});
  ok('No JavaScript errors', errs.filter(e=>!/404|401/.test(e)).length===0, errs.slice(0,3).join(' | '));
  console.log(R.join('\n')); await b.close();
})().catch(e=>{console.log(R.join('\n'));console.log('CRASH '+e.message);process.exit(1);});
