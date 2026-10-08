(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const LC = window.LightweightCharts;
  if(!LC){
    $('notice').hidden=false; $('notice').classList.add('err');
    $('noticeBody').textContent='The chart library did not load. Check your connection and reload the page.';
    return;
  }

  const STD_TF=[60,300,900,1800,3600,14400,86400];
  const SPEEDS=[1,2,4,8,16,32,64]; // raw bars revealed per second while playing
  const ICON_PLAY='<svg viewBox="0 0 24 24"><path d="M7 4.5v15L19.5 12z"/></svg>';
  const ICON_PAUSE='<svg viewBox="0 0 24 24"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/></svg>';
  const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DEMO_NAME='Demo data';
  const DEFAULTS={utOn:true,key:1,atr:10,sl:6.5,rr:2,risk:30,contract:100};

  const loadJSON=(k,f)=>{ try{ const v=JSON.parse(localStorage.getItem(k)); return v==null?f:v; }catch(e){ return f; } };
  const saveJSON=(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} };

  let bars=[], baseSec=60, tf=300, idx=0, agg=[], precision=2;
  let playing=false, picking=false, speedIdx=2, isDemo=true, srcName='';
  let demoHidden=!!loadJSON('bar-replay-demo-hidden',false), flashTimer=0;
  let raf=0, lastTs=0, acc=0;
  let cfg=Object.assign({},DEFAULTS,loadJSON('bar-replay-settings',{}));
  let book=loadJSON('bar-replay-trades',null);
  if(!book || !Array.isArray(book.trades)) book={trades:[],pos:null};
  let trades=book.trades, pos=null, posLines=[];
  let ut=null, utMarkers=[];
  let pal={up:'#0E8F77',down:'#D0473B',brass:'#A8771A'};

  /* ---------- storage ---------- */
  function save(){ saveJSON('bar-replay-state',{name:srcName,tf,speedIdx,idx}); }
  function saveBook(){ book={trades,pos}; saveJSON('bar-replay-trades',book); }
  function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open('bar-replay',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function idbGet(k){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{ const q=db.transaction('kv').objectStore('kv').get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }catch(e){ return null; } }
  async function idbSet(k,v){ try{ const db=await idbOpen(); await new Promise((res,rej)=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){} }

  /* ---------- chart ---------- */
  const chart=LC.createChart($('chart'),{
    autoSize:true,
    layout:{ fontFamily:getComputedStyle(document.body).fontFamily, fontSize:12 },
    timeScale:{ timeVisible:true, secondsVisible:false, rightOffset:6 },
    crosshair:{ mode:LC.CrosshairMode.Normal }
  });
  const series=chart.addCandlestickSeries({ borderVisible:false });

  function applyTheme(){
    const cs=getComputedStyle(document.documentElement), v=n=>cs.getPropertyValue(n).trim();
    pal={up:v('--up'),down:v('--down'),brass:v('--brass')};
    chart.applyOptions({
      layout:{ background:{ type:LC.ColorType.Solid, color:v('--bg') }, textColor:v('--muted'), fontFamily:getComputedStyle(document.body).fontFamily },
      grid:{ vertLines:{ color:v('--grid') }, horzLines:{ color:v('--grid') } },
      timeScale:{ borderColor:v('--line') },
      rightPriceScale:{ borderColor:v('--line') },
      crosshair:{ vertLine:{ labelBackgroundColor:v('--brass') }, horzLine:{ labelBackgroundColor:v('--brass') } }
    });
    series.applyOptions({ upColor:pal.up, downColor:pal.down, wickUpColor:pal.up, wickDownColor:pal.down });
    if(bars.length){ updateMarkers(); drawPosLines(); }
  }
  applyTheme();
  try{ matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme); }catch(e){}
  new MutationObserver(applyTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(applyTheme);

  /* ---------- candles ---------- */
  const bucket=t=>t-(((t%tf)+tf)%tf);
  function aggregate(n){
    const out=[]; let cur=null;
    for(let i=0;i<n;i++){
      const b=bars[i], k=bucket(b.time);
      if(cur && cur.time===k){ if(b.high>cur.high) cur.high=b.high; if(b.low<cur.low) cur.low=b.low; cur.close=b.close; }
      else { cur={time:k,open:b.open,high:b.high,low:b.low,close:b.close}; out.push(cur); }
    }
    return out;
  }
  // Candles that are finished (the last one may still be forming)
  function closedCount(){
    const n=agg.length;
    if(!n) return 0;
    if(idx>=bars.length) return n;
    return bucket(bars[idx].time)===agg[n-1].time ? n-1 : n;
  }

  /* ---------- UT Bot Alerts (same maths as the Pine script) ---------- */
  function utReset(){ ut={n:0,sumTR:0,atr:NaN,prevClose:NaN,prevStop:0}; utMarkers=[]; }
  function utAdvance(){
    if(!cfg.utOn) return false;
    const target=closedCount(), P=Math.max(1,Math.round(cfg.atr)), K=cfg.key;
    let added=false;
    while(ut.n<target){
      const i=ut.n, c=agg[i], pc=ut.prevClose;
      const tr=isNaN(pc) ? c.high-c.low : Math.max(c.high-c.low,Math.abs(c.high-pc),Math.abs(c.low-pc));
      if(i<P){ ut.sumTR+=tr; if(i===P-1) ut.atr=ut.sumTR/P; }
      else ut.atr=(tr+(P-1)*ut.atr)/P; // RMA, like ta.atr
      if(!isNaN(ut.atr) && !isNaN(pc)){
        const nLoss=K*ut.atr, src=c.close, ps=ut.prevStop;
        let stop;
        if(src>ps && pc>ps) stop=Math.max(ps,src-nLoss);
        else if(src<ps && pc<ps) stop=Math.min(ps,src+nLoss);
        else stop=src>ps ? src-nLoss : src+nLoss;
        if(src>stop && pc<=ps){ utMarkers.push({time:c.time,side:'buy'}); added=true; }
        else if(src<stop && pc>=ps){ utMarkers.push({time:c.time,side:'sell'}); added=true; }
        ut.prevStop=stop;
      }
      ut.prevClose=c.close; ut.n++;
    }
    return added;
  }

  const fileTrades=()=>trades.filter(t=>t.file===srcName);
  function updateMarkers(){
    if(!agg.length){ series.setMarkers([]); return; }
    const first=agg[0].time, cur=idx>0 ? bars[idx-1].time : -Infinity, m=[];
    if(cfg.utOn) for(const u of utMarkers){
      m.push(u.side==='buy'
        ? {time:u.time,position:'belowBar',color:pal.up,shape:'arrowUp',text:'Buy'}
        : {time:u.time,position:'aboveBar',color:pal.down,shape:'arrowDown',text:'Sell'});
    }
    const entryMark=t=>{ const et=bucket(t.entryTime); if(t.entryTime<=cur && et>=first) m.push({time:et,position:t.side==='long'?'belowBar':'aboveBar',color:pal.brass,shape:'circle',text:t.side==='long'?'Long':'Short'}); };
    for(const t of fileTrades()){
      entryMark(t);
      const xt=bucket(t.exitTime);
      if(t.exitTime<=cur && xt>=first) m.push({time:xt,position:t.side==='long'?'aboveBar':'belowBar',color:t.r>=0?pal.up:pal.down,shape:'square',text:(t.r>=0?'+':'')+t.r.toFixed(1)+'R'});
    }
    if(pos) entryMark(pos);
    m.sort((a,b)=>a.time-b.time);
    series.setMarkers(m);
  }

  /* ---------- replay engine ---------- */
  function rebuild(){
    agg=aggregate(idx); series.setData(agg);
    utReset(); utAdvance(); updateMarkers(); refresh();
  }
  function showRecent(){ const n=agg.length; if(n) chart.timeScale().setVisibleLogicalRange({from:Math.max(0,n-120),to:n+6}); }
  function revealOne(){
    const b=bars[idx], k=bucket(b.time);
    let cur=agg[agg.length-1];
    if(cur && cur.time===k){ cur.high=Math.max(cur.high,b.high); cur.low=Math.min(cur.low,b.low); cur.close=b.close; }
    else { cur={time:k,open:b.open,high:b.high,low:b.low,close:b.close}; agg.push(cur); }
    series.update({...cur});
    idx++;
    checkTrade(b);
  }
  function afterReveal(){ if(utAdvance()) updateMarkers(); refresh(); }
  function next(){
    if(picking || idx>=bars.length) return;
    setPlaying(false);
    const k=bucket(bars[idx].time);
    while(idx<bars.length && bucket(bars[idx].time)===k) revealOne();
    afterReveal(); save();
  }
  function back(){
    if(picking || idx<=1) return;
    setPlaying(false);
    const k=bucket(bars[idx-1].time);
    let j=idx;
    while(j>1 && bucket(bars[j-1].time)===k) j--;
    jumpTo(j); save();
  }
  function jumpTo(n){
    n=Math.max(1,Math.min(bars.length,n));
    if(pos){
      if(n-1<=pos.entryIdx) cancelPos('Your open trade was removed because you moved to before its entry.');
      else for(let i=idx;i<n && pos;i++) checkTrade(bars[i]);
    }
    idx=n; rebuild();
  }
  function setPlaying(p){
    const want=!!p && !picking && idx<bars.length;
    if(want===playing) return;
    playing=want;
    $('play').innerHTML=playing?ICON_PAUSE:ICON_PLAY;
    $('play').setAttribute('aria-label',playing?'Pause':'Play');
    if(playing){ lastTs=0; acc=0; raf=requestAnimationFrame(loop); }
    else { cancelAnimationFrame(raf); save(); }
  }
  function loop(ts){
    if(!playing) return;
    if(lastTs) acc+=Math.min(ts-lastTs,250)/1000*SPEEDS[speedIdx];
    lastTs=ts;
    let k=Math.floor(acc); acc-=k;
    if(k>0){ while(k-- >0 && idx<bars.length) revealOne(); afterReveal(); }
    if(idx>=bars.length){ setPlaying(false); refresh(); return; }
    raf=requestAnimationFrame(loop);
  }

  /* ---------- practice trading ---------- */
  function drawPosLines(){
    clearPosLines();
    if(!pos) return;
    const mk=(price,color,title,style)=>series.createPriceLine({price,color,lineWidth:1,lineStyle:style,axisLabelVisible:true,title});
    posLines=[
      mk(pos.entry,pal.brass,pos.side==='long'?'Long':'Short',LC.LineStyle.Solid),
      mk(pos.sl,pal.down,'SL',LC.LineStyle.Dashed),
      mk(pos.tp,pal.up,'TP',LC.LineStyle.Dashed)
    ];
  }
  function clearPosLines(){ for(const l of posLines) series.removePriceLine(l); posLines=[]; }
  function openPos(side){
    if(pos || picking || idx<1) return;
    const b=bars[idx-1], dir=side==='long'?1:-1, d=cfg.sl;
    pos={file:srcName,side,entryIdx:idx-1,entryTime:b.time,entry:b.close,
         sl:b.close-dir*d,tp:b.close+dir*d*cfg.rr,slDist:d,risk:cfg.risk,
         lots:cfg.contract>0?cfg.risk/(d*cfg.contract):0};
    drawPosLines(); updateMarkers(); refresh(); saveBook();
  }
  function checkTrade(b){
    if(!pos || b.time<=pos.entryTime) return;
    if(pos.side==='long'){
      if(b.low<=pos.sl) closePos(b.open<pos.sl?b.open:pos.sl,'Stop-loss',b.time);
      else if(b.high>=pos.tp) closePos(b.open>pos.tp?b.open:pos.tp,'Target',b.time);
    } else {
      if(b.high>=pos.sl) closePos(b.open>pos.sl?b.open:pos.sl,'Stop-loss',b.time);
      else if(b.low<=pos.tp) closePos(b.open<pos.tp?b.open:pos.tp,'Target',b.time);
    }
  }
  function closePos(price,reason,time){
    if(!pos) return;
    const dir=pos.side==='long'?1:-1, r=(price-pos.entry)*dir/pos.slDist;
    trades.push({file:pos.file,side:pos.side,entryTime:pos.entryTime,entry:pos.entry,exitTime:time,exit:price,reason,r,pnl:r*pos.risk});
    pos=null; clearPosLines(); saveBook(); updateMarkers(); renderStats();
  }
  function cancelPos(msg){ pos=null; clearPosLines(); saveBook(); flash(msg); }
  const sgn=(v,d)=>`${v>=0?'+':'−'}${Math.abs(v).toFixed(d)}`;
  const money=(v,d=2)=>`${v>=0?'+':'−'}$${Math.abs(v).toFixed(d)}`;
  function renderStats(){
    const n=fileTrades().length;
    $('statsBtn').textContent=n ? `Trades (${n})` : 'Trades';
  }
  function renderTrades(){
    const ft=fileTrades(), n=ft.length;
    const w=ft.filter(t=>t.r>0).length, l=ft.filter(t=>t.r<0).length;
    const net=ft.reduce((s,t)=>s+t.pnl,0), netR=ft.reduce((s,t)=>s+t.r,0);
    $('trSummary').textContent = n
      ? `${n} trade${n>1?'s':''}: ${w} won, ${l} lost (${Math.round(w/n*100)}% win rate). Net ${money(net)} (${sgn(netR,1)}R).`
      : 'Your practice trades on this chart will appear here.';
    $('trBody').innerHTML = n
      ? ft.slice().reverse().map(t=>{
          const c=t.r>=0?'c-up':'c-down';
          return `<tr><td>${t.side==='long'?'Long':'Short'}</td><td>${fmtCompact(t.entryTime)}</td><td>${t.reason}</td><td class="${c}">${sgn(t.r,2)}</td><td class="${c}">${money(t.pnl,0)}</td></tr>`;
        }).join('')
      : '<tr><td colspan="5" class="empty">No trades yet. Tap Buy or Sell during a replay to practise.</td></tr>';
    $('clearTrades').hidden=!n;
    $('clearTrades').textContent='Clear trades for this chart';
    $('clearTrades').dataset.armed='';
  }

  /* ---------- display ---------- */
  const pad=n=>String(n).padStart(2,'0');
  function fmtTime(t){
    const d=new Date(t*1000);
    const day=`${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return baseSec>=86400 ? day : `${day}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  function fmtCompact(t){
    const d=new Date(t*1000), day=`${d.getUTCDate()} ${MONS[d.getUTCMonth()]}`;
    return baseSec>=86400 ? `${day} ${d.getUTCFullYear()}` : `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const pct=v=>bars.length>1 ? ((v-1)/(bars.length-1)*100).toFixed(2)+'%' : '100%';
  const px=x=>x.toFixed(precision);

  function refresh(){
    const n=bars.length, s=$('scrub');
    s.max=Math.max(2,n); s.value=idx; s.style.setProperty('--p',pct(idx)); s.disabled=picking;
    if(idx>0) $('rtime').textContent=fmtTime(bars[idx-1].time);
    const c=agg[agg.length-1];
    $('ohlc').innerHTML = c
      ? `O <b>${px(c.open)}</b> H <b>${px(c.high)}</b> L <b>${px(c.low)}</b> C <b class="${c.close>=c.open?'c-up':'c-down'}">${px(c.close)}</b>`
      : '';
    $('back').disabled=picking||idx<=1;
    $('next').disabled=picking||idx>=n;
    $('play').disabled=picking||(idx>=n && !playing);
    $('buy').disabled=$('sell').disabled=picking||idx<1;
    $('orders').hidden=!!pos; $('posBox').hidden=!pos;
    if(pos && idx>0){
      const cur=bars[idx-1].close, dir=pos.side==='long'?1:-1, r=(cur-pos.entry)*dir/pos.slDist, pnl=r*pos.risk;
      $('posText').textContent=`${pos.side==='long'?'Long':'Short'} ${pos.lots.toFixed(2)} @ ${px(pos.entry)}`;
      const el=$('posPnl');
      el.textContent=`${money(pnl)} (${sgn(r,2)}R)`;
      el.className=pnl>=0?'c-up':'c-down';
    }
  }

  function tfLabel(s){ return s<60 ? s+'s' : s<3600 ? (s/60)+'m' : s<86400 ? (s/3600)+'h' : (s/86400)+'D'; }
  function tfOptions(){ return [...new Set([baseSec,...STD_TF.filter(s=>s>=baseSec && s%baseSec===0)])].sort((a,b)=>a-b); }
  function buildTfs(){
    const box=$('tfs'); box.innerHTML='';
    for(const s of tfOptions()){
      const b=document.createElement('button');
      b.type='button'; b.textContent=tfLabel(s); b.dataset.s=s;
      b.setAttribute('aria-pressed',String(s===tf));
      b.addEventListener('click',()=>setTf(s));
      box.appendChild(b);
    }
  }
  function setTf(s){
    if(s===tf) return;
    tf=s;
    for(const b of $('tfs').children) b.setAttribute('aria-pressed',String(+b.dataset.s===tf));
    if(picking) series.setData(aggregate(bars.length));
    else { rebuild(); showRecent(); }
    save();
  }

  const DEMO_HTML='Demo chart with random prices. Load a CSV exported from TradingView or MT5 to replay a real chart.'
    +'<details><summary>How to export</summary><ul>'
    +'<li>TradingView (browser or desktop): layout menu next to the layout name → Export chart data.</li>'
    +'<li>MT5 (PC): View → Symbols → Bars tab → pick symbol, timeframe and dates → Request → Export Bars.</li>'
    +'</ul>Export 1-minute bars if you want to replay every timeframe.</details>';
  function showNotice(html,kind){ const n=$('notice'); n.hidden=false; n.className='notice'+(kind?' '+kind:''); $('noticeBody').innerHTML=html; }
  function restoreNotice(){ clearTimeout(flashTimer); if(isDemo && !demoHidden) showNotice(DEMO_HTML,''); else $('notice').hidden=true; }
  function flash(msg){ showNotice(msg,'info'); clearTimeout(flashTimer); flashTimer=setTimeout(()=>{ if(!picking) restoreNotice(); },5000); }

  /* ---------- data loading ---------- */
  function setData(parsed,name,demo,st){
    setPlaying(false);
    if(picking) endPick(false);
    const savedPos=book.pos;
    clearPosLines(); pos=null;
    bars=parsed.bars; precision=parsed.precision; srcName=name; isDemo=demo;
    $('src').textContent=name;
    let minDiff=Infinity;
    for(let i=1;i<Math.min(bars.length,5000);i++){ const d=bars[i].time-bars[i-1].time; if(d>0 && d<minDiff) minDiff=d; }
    baseSec=isFinite(minDiff)?minDiff:60;
    const opts=tfOptions(), same=st && st.name===name;
    tf=same && opts.includes(st.tf) ? st.tf : (opts.includes(300)?300:opts[0]);
    if(same && SPEEDS[st.speedIdx]) speedIdx=st.speedIdx;
    $('speed').textContent=SPEEDS[speedIdx]+'×';
    idx=same && st.idx>=1 && st.idx<=bars.length ? st.idx : Math.max(1,Math.floor(bars.length*0.6));
    if(savedPos && savedPos.file===name && savedPos.entryIdx<idx && bars[savedPos.entryIdx] && bars[savedPos.entryIdx].time===savedPos.entryTime) pos=savedPos;
    series.applyOptions({ priceFormat:{ type:'price', precision, minMove:Math.pow(10,-precision) } });
    buildTfs();
    rebuild(); drawPosLines(); showRecent(); renderStats();
    restoreNotice(); save(); saveBook();
  }

  function toLocalWall(epoch){ return epoch-new Date(epoch*1000).getTimezoneOffset()*60; }
  function parseTime(s){
    s=s.trim();
    if(/^\d+(\.\d+)?$/.test(s)){ let n=+s; if(n>1e11) n/=1000; return toLocalWall(Math.floor(n)); }
    let m=s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+\-]\d{2}:?\d{2})?$/i);
    if(m){
      const [,Y,Mo,D,h='0',mi='0',se='0',z]=m;
      const t=Date.UTC(+Y,+Mo-1,+D,+h,+mi,+se)/1000;
      if(!z) return t; // no time zone: show exactly as written (e.g. MT5 server time)
      let off=0;
      if(z.toUpperCase()!=='Z'){ const sg=z[0]==='-'?-1:1, dg=z.slice(1).replace(':',''); off=sg*((+dg.slice(0,2))*60+(+dg.slice(2)))*60; }
      return toLocalWall(t-off);
    }
    m=s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if(m){
      const [,a,b,Y,h='0',mi='0',se='0']=m, dot=s.includes('.');
      return Date.UTC(+Y,(dot?+b:+a)-1,dot?+a:+b,+h,+mi,+se)/1000;
    }
    const p=Date.parse(s);
    return isNaN(p) ? NaN : toLocalWall(Math.floor(p/1000));
  }
  function parseCSV(text){
    const lines=text.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2) throw new Error('This file has no rows of price data. Export at least a few bars and try again.');
    const first=lines[0];
    const delim=first.includes('\t') ? '\t' : (first.split(';').length>first.split(',').length ? ';' : ',');
    const split=l=>l.split(delim).map(x=>x.trim().replace(/^"|"$/g,''));
    const head=split(first).map(h=>h.toLowerCase().replace(/[<>]/g,'').trim());
    const hasHeader=head.some(h=>/[a-z]/.test(h) && !/^\d/.test(h));
    let iD=-1,iT=-1,iO=-1,iH=-1,iL=-1,iC=-1;
    if(hasHeader){
      head.forEach((h,i)=>{
        if(iO<0 && (h==='open'||h==='o')) iO=i;
        else if(iH<0 && (h==='high'||h==='h')) iH=i;
        else if(iL<0 && (h==='low'||h==='l')) iL=i;
        else if(iC<0 && (h==='close'||h==='c'||h==='last')) iC=i;
        else if(iD<0 && h==='date') iD=i;
        else if(iT<0 && (h==='time'||h==='datetime'||h==='timestamp'||h==='date time'||h==='gmt time'||h==='local time')) iT=i;
      });
    } else {
      const c=split(first);
      if(/^\d{1,2}:\d{2}/.test(c[1]||'')){ iD=0;iT=1;iO=2;iH=3;iL=4;iC=5; } else { iT=0;iO=1;iH=2;iL=3;iC=4; }
    }
    if([iO,iH,iL,iC].some(i=>i<0) || (iD<0 && iT<0))
      throw new Error('Couldn’t find time, open, high, low and close columns in this file. Export it again from TradingView (Export chart data) or MT5 (Export Bars).');
    const out=[]; let prec=0;
    for(let r=hasHeader?1:0;r<lines.length;r++){
      const c=split(lines[r]);
      const ts=iD>=0 && iT>=0 ? c[iD]+' '+c[iT] : c[iD>=0?iD:iT];
      const t=parseTime(ts||'');
      const o=parseFloat(c[iO]), h=parseFloat(c[iH]), l=parseFloat(c[iL]), cl=parseFloat(c[iC]);
      if(!isFinite(t) || [o,h,l,cl].some(v=>!isFinite(v))) continue;
      if(r<300){ const dec=(c[iC]||'').split('.')[1]; if(dec) prec=Math.max(prec,dec.length); }
      out.push({time:Math.floor(t),open:o,high:Math.max(h,o,cl),low:Math.min(l,o,cl),close:cl});
    }
    if(out.length<2) throw new Error('Couldn’t read any price rows from this file. Check that it is a CSV of bars with a time column.');
    out.sort((a,b)=>a.time-b.time);
    const res=[];
    for(const b of out){ if(res.length && res[res.length-1].time===b.time) res[res.length-1]=b; else res.push(b); }
    return {bars:res,precision:Math.min(Math.max(prec,2),5)};
  }
  function makeDemo(){
    let s=20260914>>>0;
    const rnd=()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; };
    const out=[]; let p=2500, drift=0, t=Date.UTC(2026,8,14)/1000;
    for(let i=0;i<5*1440;i++){
      if(i%180===0) drift=(rnd()-0.5)*0.12;
      const m=i%1440, vol=0.25+0.6*Math.pow(Math.sin((m/1440)*Math.PI*2-1.2),2);
      const o=p, c=o+drift+(rnd()+rnd()+rnd()-1.5)*vol*1.3;
      const h=Math.max(o,c)+rnd()*vol*0.7, l=Math.min(o,c)-rnd()*vol*0.7;
      out.push({time:t,open:+o.toFixed(2),high:+h.toFixed(2),low:+l.toFixed(2),close:+c.toFixed(2)});
      p=c; t+=60;
    }
    return {bars:out,precision:2};
  }

  /* ---------- pick start on chart ---------- */
  function startPick(){
    setPlaying(false);
    picking=true;
    $('pick').setAttribute('aria-pressed','true'); $('pick').textContent='Cancel';
    series.setData(aggregate(bars.length));
    showNotice('Tap the candle where the replay should start.','pick');
    refresh();
  }
  function endPick(redraw){
    picking=false;
    $('pick').setAttribute('aria-pressed','false'); $('pick').textContent='Pick start';
    restoreNotice();
    if(redraw){ rebuild(); showRecent(); }
  }
  chart.subscribeClick(p=>{
    if(!picking || p.time===undefined) return;
    const end=p.time+tf; let lo=0, hi=bars.length;
    while(lo<hi){ const mid=(lo+hi)>>1; if(bars[mid].time<end) lo=mid+1; else hi=mid; }
    endPick(false);
    jumpTo(lo); showRecent(); save();
  });

  /* ---------- events ---------- */
  $('play').innerHTML=ICON_PLAY;
  $('play').addEventListener('click',()=>setPlaying(!playing));
  $('next').addEventListener('click',next);
  $('back').addEventListener('click',back);
  $('pick').addEventListener('click',()=>picking?endPick(true):startPick());
  $('speed').addEventListener('click',()=>{ speedIdx=(speedIdx+1)%SPEEDS.length; $('speed').textContent=SPEEDS[speedIdx]+'×'; save(); });
  $('buy').addEventListener('click',()=>openPos('long'));
  $('sell').addEventListener('click',()=>openPos('short'));
  $('closePos').addEventListener('click',()=>{ if(pos && idx>0){ closePos(bars[idx-1].close,'Closed',bars[idx-1].time); refresh(); } });
  $('dismiss').addEventListener('click',()=>{ $('notice').hidden=true; if(isDemo && !picking){ demoHidden=true; saveJSON('bar-replay-demo-hidden',true); } });
  $('load').addEventListener('click',()=>$('file').click());
  $('file').addEventListener('change',async e=>{
    const f=e.target.files[0]; e.target.value='';
    if(!f) return;
    try{
      const parsed=parseCSV(await f.text());
      setData(parsed,f.name,false,loadJSON('bar-replay-state',null));
      idbSet('data',{name:f.name,bars:parsed.bars,precision:parsed.precision});
    }catch(err){ showNotice(err.message,'err'); }
  });
  const scrub=$('scrub');
  scrub.addEventListener('input',()=>{
    setPlaying(false);
    const v=+scrub.value;
    scrub.style.setProperty('--p',pct(v));
    if(bars[v-1]) $('rtime').textContent=fmtTime(bars[v-1].time);
  });
  scrub.addEventListener('change',()=>{ jumpTo(+scrub.value); showRecent(); save(); });

  // settings
  const fields={sKey:'key',sAtr:'atr',sSl:'sl',sRr:'rr',sRisk:'risk',sContract:'contract'};
  $('settingsBtn').addEventListener('click',()=>{
    setPlaying(false);
    $('sUt').checked=cfg.utOn;
    for(const id in fields) $(id).value=cfg[fields[id]];
    $('setErr').hidden=true;
    $('settings').showModal();
  });
  $('saveSettings').addEventListener('click',()=>{
    const v={utOn:$('sUt').checked};
    for(const id in fields) v[fields[id]]=parseFloat($(id).value);
    v.atr=Math.round(v.atr);
    if(Object.keys(fields).some(id=>!(v[fields[id]]>0))){
      $('setErr').textContent='Every number must be above zero.'; $('setErr').hidden=false; return;
    }
    const utChanged=v.utOn!==cfg.utOn || v.key!==cfg.key || v.atr!==cfg.atr;
    cfg=v; saveJSON('bar-replay-settings',cfg);
    if(utChanged){ utReset(); utAdvance(); updateMarkers(); }
    $('settings').close();
  });
  // trades
  $('statsBtn').addEventListener('click',()=>{ renderTrades(); $('tradesDlg').showModal(); });
  $('clearTrades').addEventListener('click',e=>{
    const b=e.currentTarget;
    if(!b.dataset.armed){ b.dataset.armed='1'; b.textContent='Tap again to clear'; return; }
    trades=trades.filter(t=>t.file!==srcName); saveBook();
    updateMarkers(); renderStats(); renderTrades();
  });
  for(const d of document.querySelectorAll('dialog')) d.addEventListener('click',e=>{ if(e.target===d) d.close(); });
  for(const b of document.querySelectorAll('[data-close]')) b.addEventListener('click',()=>b.closest('dialog').close());

  document.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]')) return;
    const tag=(e.target.tagName||'').toLowerCase();
    if(tag==='input') return;
    const k=e.key.toLowerCase();
    if((k===' ' && tag!=='button') || (e.shiftKey && k==='arrowdown')){ e.preventDefault(); setPlaying(!playing); }
    else if(k==='arrowright'){ e.preventDefault(); next(); }
    else if(k==='arrowleft'){ e.preventDefault(); back(); }
    else if(k==='b' && !pos) openPos('long');
    else if(k==='s' && !pos) openPos('short');
    else if(k==='c' && pos) $('closePos').click();
  });

  /* ---------- start ---------- */
  (async()=>{
    const st=loadJSON('bar-replay-state',null);
    const saved=await idbGet('data');
    if(saved && saved.bars && saved.bars.length>1) setData({bars:saved.bars,precision:saved.precision||2},saved.name,false,st);
    else setData(makeDemo(),DEMO_NAME,true,st);
  })();
})();
