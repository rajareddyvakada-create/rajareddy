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
  const DEFAULTS={sl:6.5,rr:2,risk:30,contract:100};

  const PFX='chart.';
  const loadJSON=(k,f)=>{ try{ const v=JSON.parse(localStorage.getItem(PFX+k)); return v==null?f:v; }catch(e){ return f; } };
  const saveJSON=(k,v)=>{ try{ localStorage.setItem(PFX+k,JSON.stringify(v)); }catch(e){} };

  let bars=[], baseSec=60, tf=300, idx=0, agg=[], precision=2;
  let playing=false, picking=false, speedIdx=2, isDemo=true, srcName='';
  let demoHidden=false, flashTimer=0;
  let raf=0, lastTs=0, acc=0;
  let cfg=Object.assign({},DEFAULTS), book={trades:[],pos:null};
  let trades=book.trades, pos=null, posLines=[];
  let isOnline=false, liveState='off', session=0, stopStream=null;
  const DEFAULT_SOURCE={type:'yahoo',symbol:'GC=F',label:'Gold',res:'1m',days:2,key:''};
  const toLocalWall=epoch=>epoch-new Date(epoch*1000).getTimezoneOffset()*60;
  const nowWall=()=>toLocalWall(Math.floor(Date.now()/1000));
  let pal={up:'#0E8F77',down:'#D0473B',brass:'#A8771A'};

  /* ---------- storage ---------- */
  function save(){ saveJSON('bar-replay-state',{name:srcName,tf,speedIdx,idx}); }
  function saveBook(){ book={trades,pos}; saveJSON('bar-replay-trades',book); }
  function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open('bar-replay',1); r.onupgradeneeded=()=>r.result.createObjectStore('kv'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
  async function idbGet(k){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{ const q=db.transaction('kv').objectStore('kv').get(PFX+k); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }catch(e){ return null; } }
  async function idbSet(k,v){ try{ const db=await idbOpen(); await new Promise((res,rej)=>{ const tx=db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,PFX+k); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); }catch(e){} }

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
    pal={up:v('--up'),down:v('--down'),brass:v('--brass'),muted:v('--muted')};
    chart.applyOptions({
      layout:{ background:{ type:LC.ColorType.Solid, color:v('--bg') }, textColor:v('--muted'), fontFamily:getComputedStyle(document.body).fontFamily },
      grid:{ vertLines:{ color:v('--grid') }, horzLines:{ color:v('--grid') } },
      timeScale:{ borderColor:v('--line') },
      rightPriceScale:{ borderColor:v('--line') },
      crosshair:{ vertLine:{ labelBackgroundColor:v('--brass') }, horzLine:{ labelBackgroundColor:v('--brass') } }
    });
    series.applyOptions({ upColor:pal.up, downColor:pal.down, wickUpColor:pal.up, wickDownColor:pal.down });
    if(bars.length){ computeIndicators(true); updateMarkers(); drawPosLines(); }
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
      if(cur && cur.time===k){ if(b.high>cur.high) cur.high=b.high; if(b.low<cur.low) cur.low=b.low; cur.close=b.close; cur.volume+=b.volume||0; }
      else { cur={time:k,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0}; out.push(cur); }
    }
    return out;
  }
  // Candles that are finished (the last one may still be forming)
  function closedCount(){
    const n=agg.length;
    if(!n) return 0;
    if(idx<bars.length) return bucket(bars[idx].time)===agg[n-1].time ? n-1 : n;
    return isOnline && nowWall()<agg[n-1].time+tf ? n-1 : n; // live: newest candle still forming
  }

  /* ---------- indicators (indicators.js) ---------- */
  const IND=window.ChartIndicators||[];
  let indCfg={}, indN=-1, indMarkers=[], lineSeries={};
  function indSettings(ind){
    const s={on:ind.defaultOn!==false};
    for(const f of ind.inputs) s[f.key]=f.def;
    return Object.assign(s,indCfg[ind.id]||{});
  }
  function renderPanel(rows){
    const el=$('indPanel'); if(!el) return;
    el.hidden=!rows.length;
    el.innerHTML='';
    for(const r of rows){
      const d=document.createElement('div'); d.className='prow '+(r.tone||'flat');
      const b=document.createElement('b'); b.textContent=r.label; const s=document.createElement('span'); s.textContent=r.text;
      d.append(b,s); el.appendChild(d);
    }
  }
  // Recalculates from closed candles only; returns true when anything was redrawn.
  function computeIndicators(force){
    const n=closedCount();
    if(!force && n===indN) return false;
    indN=n;
    const candles=agg.slice(0,n), markers=[], seen={}, panel=[], ctx={tf,tick:Math.pow(10,-precision)};
    for(const ind of IND){
      const s=indSettings(ind);
      if(!s.on) continue;
      let out={};
      try{ out=ind.compute(candles,s,pal,ctx)||{}; }catch(e){ console.error(ind.id,e); }
      for(const mk of out.markers||[]) markers.push(mk);
      for(const r of out.panel||[]) panel.push(r);
      for(const ln of out.lines||[]){
        seen[ln.id]=1;
        let ser=lineSeries[ln.id];
        if(!ser) ser=lineSeries[ln.id]=chart.addLineSeries({lineWidth:ln.width||2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
        ser.applyOptions({color:ln.color||pal.brass,priceFormat:{type:'price',precision,minMove:Math.pow(10,-precision)}});
        ser.setData(ln.data);
      }
    }
    for(const id in lineSeries) if(!seen[id]){ chart.removeSeries(lineSeries[id]); delete lineSeries[id]; }
    indMarkers=markers;
    renderPanel(panel);
    return true;
  }

  const fileTrades=()=>trades.filter(t=>t.file===srcName);
  function updateMarkers(){
    if(!agg.length){ series.setMarkers([]); return; }
    const first=agg[0].time, cur=idx>0 ? bars[idx-1].time : -Infinity, m=[];
    for(const u of indMarkers){
      if(u.shape){ m.push({time:u.time,position:u.position,color:u.color,shape:u.shape,text:u.text}); continue; }
      m.push(u.side==='buy'
        ? {time:u.time,position:'belowBar',color:pal.up,shape:'arrowUp',text:u.text||'BUY'}
        : {time:u.time,position:'aboveBar',color:pal.down,shape:'arrowDown',text:u.text||'SELL'});
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
    agg=aggregate(idx); series.setData(agg.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
    computeIndicators(true); updateMarkers(); refresh();
  }
  function showRecent(){ const n=agg.length; if(n) chart.timeScale().setVisibleLogicalRange({from:Math.max(0,n-120),to:n+6}); }
  function revealOne(){
    const b=bars[idx], k=bucket(b.time);
    let cur=agg[agg.length-1];
    if(cur && cur.time===k){ cur.high=Math.max(cur.high,b.high); cur.low=Math.min(cur.low,b.low); cur.close=b.close; cur.volume+=b.volume||0; }
    else { cur={time:k,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0}; agg.push(cur); }
    series.update({time:cur.time,open:cur.open,high:cur.high,low:cur.low,close:cur.close});
    idx++;
    checkTrade(b);
  }
  function afterReveal(){ if(computeIndicators()) updateMarkers(); refresh(); }

  /* ---------- live data ---------- */
  function syncLastCandle(){
    const i=idx-1, k=bucket(bars[i].time);
    let j=i;
    while(j>0 && bucket(bars[j-1].time)===k) j--;
    const c={time:k,open:bars[j].open,high:-Infinity,low:Infinity,close:bars[i].close,volume:0};
    for(let x=j;x<=i;x++){ if(bars[x].high>c.high) c.high=bars[x].high; if(bars[x].low<c.low) c.low=bars[x].low; c.volume+=bars[x].volume||0; }
    const n=agg.length;
    if(n && agg[n-1].time===k) agg[n-1]=c; else agg.push(c);
    series.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close});
  }
  function ingest(list){
    if(!bars.length) return;
    const live=idx===bars.length && !picking;
    let changed=false;
    for(const b of list){
      const last=bars[bars.length-1];
      if(b.time<last.time) continue;
      if(b.time===last.time) bars[bars.length-1]=b; else bars.push(b);
      changed=true;
      if(live){ idx=bars.length; syncLastCandle(); checkTick(b); }
    }
    if(!changed) return;
    if(live && computeIndicators()) updateMarkers();
    refresh();
  }
  function stopLive(){ session++; if(stopStream){ stopStream(); stopStream=null; } liveState='off'; }
  let loadSeq=0;
  async function loadSource(src,st){
    const req=++loadSeq;
    const res=await window.BRData.load(src); // keep the current chart live until the new data arrives
    if(req!==loadSeq) return;
    stopLive();
    const my=session;
    setData(res,res.name,false,st||loadJSON('bar-replay-state',null),true);
    saveJSON('bar-replay-source',src);
    stopStream=window.BRData.stream(src,res,
      list=>{ if(my===session) ingest(list); },
      state=>{ if(my===session){ liveState=state; refresh(); } });
  }
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
  // Live updates: a bar that started after the entry can use its full range; the entry bar only its latest price
  function checkTick(b){
    if(!pos) return;
    if(b.time>pos.entryTime){ checkTrade(b); return; }
    const p=b.close;
    if(pos.side==='long'){ if(p<=pos.sl) closePos(pos.sl,'Stop-loss',b.time); else if(p>=pos.tp) closePos(pos.tp,'Target',b.time); }
    else { if(p>=pos.sl) closePos(pos.sl,'Stop-loss',b.time); else if(p<=pos.tp) closePos(pos.tp,'Target',b.time); }
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
    const lb=$('liveBadge');
    lb.hidden=!isOnline || !n;
    if(isOnline){
      if(idx<n){ lb.textContent='Replay, go live'; lb.className='live replay'; }
      else {
        const txt={on:'Live',connecting:'Connecting…',off:'Offline, retrying',limit:'API limit reached'}[liveState]||'Live';
        lb.textContent=txt; lb.className='live '+(liveState==='on'?'on':'off');
      }
    }
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
    if(picking) series.setData(aggregate(bars.length).map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
    else { rebuild(); showRecent(); }
    save();
  }

  const DEMO_HTML='Demo chart with random prices. Tap the market name above to load a real chart.'
    +'<details><summary>How to export</summary><ul>'
    +'<li>TradingView (browser or desktop): layout menu next to the layout name → Export chart data.</li>'
    +'<li>MT5 (PC): View → Symbols → Bars tab → pick symbol, timeframe and dates → Request → Export Bars.</li>'
    +'</ul>Export 1-minute bars if you want to replay every timeframe.</details>';
  function showNotice(html,kind){ const n=$('notice'); n.hidden=false; n.className='notice'+(kind?' '+kind:''); $('noticeBody').innerHTML=html; }
  function restoreNotice(){ clearTimeout(flashTimer); if(isDemo && !demoHidden) showNotice(DEMO_HTML,''); else $('notice').hidden=true; }
  function flash(msg){ showNotice(msg,'info'); clearTimeout(flashTimer); flashTimer=setTimeout(()=>{ if(!picking) restoreNotice(); },5000); }

  /* ---------- data loading ---------- */
  function findTime(t){ let lo=0,hi=bars.length-1; while(lo<=hi){ const m=(lo+hi)>>1; if(bars[m].time===t) return m; if(bars[m].time<t) lo=m+1; else hi=m-1; } return -1; }
  function setData(parsed,name,demo,st,online){
    setPlaying(false);
    isOnline=!!online;
    if(picking) endPick(false);
    const savedPos=book.pos;
    clearPosLines(); pos=null;
    bars=parsed.bars; precision=parsed.precision; srcName=name; isDemo=demo;
    $('src').textContent=name;
    for(const id in lineSeries){ chart.removeSeries(lineSeries[id]); delete lineSeries[id]; }
    let minDiff=Infinity;
    for(let i=1;i<Math.min(bars.length,5000);i++){ const d=bars[i].time-bars[i-1].time; if(d>0 && d<minDiff) minDiff=d; }
    baseSec=isFinite(minDiff)?minDiff:60;
    const opts=tfOptions(), same=st && st.name===name;
    tf=same && opts.includes(st.tf) ? st.tf : (opts.includes(300)?300:opts[0]);
    if(same && SPEEDS[st.speedIdx]) speedIdx=st.speedIdx;
    $('speed').textContent=SPEEDS[speedIdx]+'×';
    if(isOnline) idx=bars.length; // online data opens live; use Pick start or the slider to replay
    else idx=same && st.idx>=1 && st.idx<=bars.length ? st.idx : Math.max(1,Math.floor(bars.length*0.6));
    let droppedPos=false;
    if(savedPos && savedPos.file===name){
      const j=findTime(savedPos.entryTime);
      if(j>=0 && j<idx) pos={...savedPos,entryIdx:j}; else droppedPos=true;
    }
    series.applyOptions({ priceFormat:{ type:'price', precision, minMove:Math.pow(10,-precision) } });
    buildTfs();
    rebuild(); drawPosLines(); showRecent(); renderStats();
    restoreNotice(); save(); saveBook();
    if(droppedPos) flash('Your open trade from last time was outside the loaded data, so it was removed.');
  }

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
    series.setData(aggregate(bars.length).map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
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
  $('file').addEventListener('change',async e=>{
    const f=e.target.files[0]; e.target.value='';
    if(!f) return;
    try{
      const parsed=parseCSV(await f.text());
      stopLive();
      setData(parsed,f.name,false,loadJSON('bar-replay-state',null),false);
      saveJSON('bar-replay-source',{type:'csv'});
      idbSet('data',{name:f.name,bars:parsed.bars,precision:parsed.precision});
      $('dataDlg').close();
    }catch(err){ $('dataErr').textContent=err.message; $('dataErr').hidden=false; if(!$('dataDlg').open) showNotice(err.message,'err'); }
  });

  // data source dialog
  const srcType=()=>(document.querySelector('input[name=src]:checked')||{}).value||'yahoo';
  const DEF_SYM={binance:'PAXGUSDT',twelve:'XAU/USD'};
  function syncDataForm(){
    const t=srcType();
    $('yahooFields').hidden=t!=='yahoo';
    $('onlineFields').hidden=t!=='binance' && t!=='twelve';
    $('keyField').hidden=t!=='twelve';
    $('loadData').textContent=t==='csv'?'Choose CSV file':'Load chart';
  }
  for(const r of document.querySelectorAll('input[name=src]')) r.addEventListener('change',()=>{
    const t=srcType();
    if((t==='binance'||t==='twelve') && Object.values(DEF_SYM).includes($('dSym').value||DEF_SYM[t])) $('dSym').value=DEF_SYM[t];
    $('dataErr').hidden=true; syncDataForm();
  });
  function openDataDialog(){
    setPlaying(false);
    const s=Object.assign({},DEFAULT_SOURCE,loadJSON('bar-replay-source',{}));
    for(const r of document.querySelectorAll('input[name=src]')) r.checked=r.value===s.type;
    const known=[...$('dMarket').options].some(o=>o.value===s.symbol);
    $('dMarket').value=s.type==='yahoo' && known ? s.symbol : (s.type==='yahoo' ? 'other' : 'GC=F');
    $('dOther').value=s.type==='yahoo' && !known ? s.symbol : '';
    $('otherField').hidden=$('dMarket').value!=='other';
    $('dRes').value=s.res||'1m';
    $('dSym').value=s.type==='binance'||s.type==='twelve' ? s.symbol : DEF_SYM.binance;
    $('dKey').value=loadJSON('bar-replay-twelve-key','');
    $('dDays').value=String(s.days||2);
    $('dataErr').hidden=true;
    syncDataForm();
    $('dataDlg').showModal();
  }
  $('dMarket').addEventListener('change',()=>{ $('otherField').hidden=$('dMarket').value!=='other'; });
  $('dataBtn').addEventListener('click',openDataDialog);
  $('loadData').addEventListener('click',async()=>{
    const t=srcType();
    if(t==='csv'){ $('file').click(); return; }
    let src;
    if(t==='yahoo'){
      const v=$('dMarket').value, sym=v==='other' ? $('dOther').value.trim().toUpperCase() : v;
      const label=v==='other' ? sym : $('dMarket').selectedOptions[0].textContent.replace(/\s*\(.*$/,'');
      src={type:'yahoo',symbol:sym,label,res:$('dRes').value};
    } else {
      const key=$('dKey').value.trim();
      if(t==='twelve') saveJSON('bar-replay-twelve-key',key);
      src={type:t,symbol:$('dSym').value.trim()||DEF_SYM[t],days:+$('dDays').value||2,key:t==='twelve'?key:''};
    }
    const b=$('loadData'); b.disabled=true; b.textContent='Loading…'; $('dataErr').hidden=true;
    try{ await loadSource(src); $('dataDlg').close(); }
    catch(e){ $('dataErr').textContent=e.message; $('dataErr').hidden=false; }
    finally{ b.disabled=false; syncDataForm(); }
  });
  // The Markets tab opens a chart here through postMessage.
  window.addEventListener('message',async e=>{
    const d=e.data||{};
    if(d.type!=='openMarket' || !d.ticker) return;
    const cur=loadJSON('bar-replay-source',{});
    if(cur.type==='yahoo' && cur.symbol===d.ticker) return;
    showNotice('Loading '+(d.name||d.ticker)+'…','info');
    try{ await loadSource({type:'yahoo',symbol:d.ticker,label:d.name||d.ticker,res:cur.type==='yahoo'&&cur.res?cur.res:'1m'}); restoreNotice(); }
    catch(err){ showNotice(err.message,'err'); }
  });
  $('liveBadge').addEventListener('click',()=>{ if(idx<bars.length){ setPlaying(false); jumpTo(bars.length); showRecent(); save(); } });

  const scrub=$('scrub');
  scrub.addEventListener('input',()=>{
    setPlaying(false);
    const v=+scrub.value;
    scrub.style.setProperty('--p',pct(v));
    if(bars[v-1]) $('rtime').textContent=fmtTime(bars[v-1].time);
  });
  scrub.addEventListener('change',()=>{ jumpTo(+scrub.value); showRecent(); save(); });

  // indicators panel: one toggle per indicator, its inputs below; changes apply at once
  function renderIndicators(){
    const box=$('indList'); box.innerHTML='';
    for(const ind of IND){
      const s=indSettings(ind), sec=document.createElement('section');
      sec.className='ind';
      const head=document.createElement('label');
      head.className='ind-head';
      head.innerHTML=`<span><b>${ind.name}</b><small>${ind.about||''}</small></span><span class="switch"><input type="checkbox" role="switch"></span>`;
      const main=head.querySelector('input'); main.checked=s.on;
      const body=document.createElement('div'); body.className='ind-body'; body.hidden=!s.on;
      main.addEventListener('change',()=>{ setInd(ind,'on',main.checked); body.hidden=!main.checked; });
      for(const f of ind.inputs){
        if(f.type==='heading'){ const h=document.createElement('div'); h.className='ind-sub'; h.textContent=f.label; body.appendChild(h); continue; }
        const row=document.createElement('label'); row.className='field';
        if(f.type==='select'){
          row.innerHTML=`<span>${f.label}</span><select></select>`;
          const sel=row.querySelector('select');
          for(const [v,l] of f.options){ const o=document.createElement('option'); o.value=v; o.textContent=l; sel.appendChild(o); }
          sel.value=s[f.key];
          sel.addEventListener('change',()=>setInd(ind,f.key,sel.value));
        } else if(f.type==='bool'){
          row.innerHTML=`<span>${f.label}</span><span class="switch"><input type="checkbox" role="switch"></span>`;
          const inp=row.querySelector('input'); inp.checked=!!s[f.key];
          inp.addEventListener('change',()=>setInd(ind,f.key,inp.checked));
        } else {
          row.innerHTML=`<span>${f.label}</span><input type="number" inputmode="decimal">`;
          const inp=row.querySelector('input');
          inp.step=f.step||'any'; if(f.min!=null) inp.min=f.min; inp.value=s[f.key];
          inp.addEventListener('change',()=>{
            let v=parseFloat(inp.value);
            if(!isFinite(v) || (f.min!=null && v<f.min)){ inp.value=indSettings(ind)[f.key]; flash(f.label+' must be at least '+f.min+'.'); return; }
            if(f.int) v=Math.round(v);
            inp.value=v; setInd(ind,f.key,v);
          });
        }
        body.appendChild(row);
      }
      sec.append(head,body); box.appendChild(sec);
    }
  }
  function setInd(ind,key,val){
    indCfg[ind.id]=Object.assign({},indCfg[ind.id]||{},{[key]:val});
    saveJSON('indicators',indCfg);
    computeIndicators(true); updateMarkers();
  }
  const fields={sSl:'sl',sRr:'rr',sRisk:'risk',sContract:'contract'};
  $('settingsBtn').addEventListener('click',()=>{
    setPlaying(false);
    renderIndicators();
    for(const id in fields) $(id).value=cfg[fields[id]];
    $('setErr').hidden=true;
    $('settings').showModal();
  });
  $('saveSettings').addEventListener('click',()=>{
    const v={};
    for(const id in fields) v[fields[id]]=parseFloat($(id).value);
    if(Object.keys(fields).some(id=>!(v[fields[id]]>0))){
      $('setErr').textContent='Every number must be above zero.'; $('setErr').hidden=false; return;
    }
    cfg=v; saveJSON('bar-replay-settings',cfg);
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
  window.appBack=()=>{ const d=document.querySelector('dialog[open]'); if(d){ d.close(); return true; } if(picking){ endPick(true); return true; } return false; };
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
    cfg=Object.assign({},DEFAULTS,loadJSON('bar-replay-settings',{}));
    indCfg=loadJSON('indicators',{});
    book=loadJSON('bar-replay-trades',null);
    if(!book || !Array.isArray(book.trades)) book={trades:[],pos:null};
    trades=book.trades;
    demoHidden=!!loadJSON('bar-replay-demo-hidden',false);
    renderStats();
    const st=loadJSON('bar-replay-state',null);
    let src=loadJSON('bar-replay-source',null) || (window.BRData ? DEFAULT_SOURCE : {type:'csv'});
    const hashT=decodeURIComponent(location.hash.slice(1));
    if(hashT && hashT!==src.symbol){
      const opt=[...$('dMarket').options].find(o=>o.value===hashT);
      src={type:'yahoo',symbol:hashT,label:opt?opt.textContent.replace(/\s*\(.*$/,''):hashT,res:src.type==='yahoo'&&src.res?src.res:'1m'};
    }
    if(src.type!=='csv' && window.BRData){
      $('src').textContent=src.label||src.symbol;
      showNotice('Loading '+(src.label||src.symbol)+'…','info');
      try{ await loadSource(src,st); return; }
      catch(e){ setData(makeDemo(),DEMO_NAME,true,st,false); showNotice(e.message+' Showing demo data for now. Tap the market name to try again.','err'); return; }
    }
    const saved=await idbGet('data');
    if(saved && saved.bars && saved.bars.length>1) setData({bars:saved.bars,precision:saved.precision||2},saved.name,false,st,false);
    else setData(makeDemo(),DEMO_NAME,true,st,false);
  })();
})();
