// CBDR (Central Bank Dealers Range), Asian range and Flout for Bar Replay.
// Pure logic, no drawing: finds the ranges and the entry setups from the bars.
// Times are New York time (14:00-20:00 CBDR, 20:00-24:00 Asian, 14:00-24:00 Flout).
// Exposed as window.BRCbdr; tests/test_cbdr.js runs the same file under node.
(function(root){
  'use strict';

  // Minutes after midnight, New York clock. End is exclusive.
  const WINDOWS=[
    {name:'CBDR',  start:14*60, end:20*60},
    {name:'ASIA',  start:20*60, end:24*60},
    {name:'FLOUT', start:14*60, end:24*60}
  ];
  const ENTRY_END_MIN=12*60; // setups stop being looked for at 12:00 NY the next day
  const DOW={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  const FMT=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short'});

  // instant = real UTC seconds. Returns the New York calendar date, minute of day and weekday.
  function nyInfo(instant){
    const p={};
    for(const x of FMT.formatToParts(new Date(instant*1000))) p[x.type]=x.value;
    return {ymd:p.year+'-'+p.month+'-'+p.day, min:((+p.hour)%24)*60+(+p.minute), dow:DOW[p.weekday]};
  }

  // Finds CBDR / Asian / Flout ranges and the first CBDR sweep-and-reclaim setup of each day.
  // bars: [{time (chart wall seconds), open, high, low, close}] sorted by time
  // o: { instantOf(bar)->real UTC seconds, baseSec, useBodies, skipSun, wideMax (price, 0 = off),
  //      tpSd (1-4), slPad (price), setupOn }
  function analyse(bars,o){
    const ranges=[], setups=[];
    if(!bars.length) return {ranges,setups};
    const info=bars.map(b=>nyInfo(o.instantOf(b)));
    const groups=new Map();
    for(let i=0;i<bars.length;i++){
      const b=bars[i], n=info[i];
      if(o.skipSun && n.dow===0) continue; // Sunday evening is a partial session
      for(const W of WINDOWS){
        if(n.min<W.start || n.min>=W.end) continue;
        const key=W.name+'|'+n.ymd;
        let r=groups.get(key);
        if(!r){
          r={name:W.name,ymd:n.ymd,i0:i,i1:i,t0:b.time,t1:b.time+o.baseSec,hi:-Infinity,lo:Infinity};
          groups.set(key,r); ranges.push(r);
        }
        const hs=o.useBodies?Math.max(b.open,b.close):b.high;
        const ls=o.useBodies?Math.min(b.open,b.close):b.low;
        if(hs>r.hi) r.hi=hs;
        if(ls<r.lo) r.lo=ls;
        r.i1=i; r.t1=b.time+o.baseSec;
      }
    }
    for(const r of ranges){
      r.h=r.hi-r.lo;
      r.wide=o.wideMax>0 && r.h>o.wideMax;
    }
    if(o.setupOn){
      for(const r of ranges){
        if(r.name!=='CBDR' || r.wide || !(r.h>0)) continue;
        const s=scanSetup(bars,info,r,o);
        if(s) setups.push(s);
      }
    }
    return {ranges,setups};
  }

  // Sweep of one side of the CBDR, then a candle closes back inside: entry at that close.
  // Long: low goes under CBDR low and a close returns above it. Stop below the sweep low, target above CBDR high.
  // Short: the mirror image.
  function scanSetup(bars,info,r,o){
    let lowEx=Infinity, lowIdx=-1, highEx=-Infinity, highIdx=-1;
    for(let j=r.i1+1;j<bars.length;j++){
      const n=info[j];
      if(n.ymd>r.ymd && n.min>=ENTRY_END_MIN) break;
      const b=bars[j];
      if(b.low<r.lo && b.low<lowEx){ lowEx=b.low; lowIdx=j; }
      if(b.high>r.hi && b.high>highEx){ highEx=b.high; highIdx=j; }
      if(lowIdx>=0 && b.close>r.lo) return build(r,bars,'long',j,lowEx,lowIdx,o);
      if(highIdx>=0 && b.close<r.hi) return build(r,bars,'short',j,highEx,highIdx,o);
    }
    return null;
  }

  function build(r,bars,side,j,ex,exIdx,o){
    const dir=side==='long'?1:-1, b=bars[j], entry=b.close, h=r.h;
    const sl=side==='long'?ex-o.slPad:ex+o.slPad;
    const tp=side==='long'?r.hi+o.tpSd*h:r.lo-o.tpSd*h;
    const risk=(entry-sl)*dir, reward=(tp-entry)*dir;
    if(!(risk>0) || !(reward>0)) return null; // target already behind price: no clean setup
    // Outcome uses the same rule as the practice trades: stop first if one bar touches both.
    let outcome='open', exitIdx=-1, exit=null;
    for(let k=j+1;k<bars.length;k++){
      const x=bars[k];
      if(side==='long'){
        if(x.low<=sl){ outcome='sl'; exit=x.open<sl?x.open:sl; }
        else if(x.high>=tp){ outcome='tp'; exit=x.open>tp?x.open:tp; }
      } else {
        if(x.high>=sl){ outcome='sl'; exit=x.open>sl?x.open:sl; }
        else if(x.low<=tp){ outcome='tp'; exit=x.open<tp?x.open:tp; }
      }
      if(outcome!=='open'){ exitIdx=k; break; }
    }
    return {
      side, ymd:r.ymd, rangeT0:r.t0, rangeHi:r.hi, rangeLo:r.lo, h,
      sweepTime:bars[exIdx].time, sweepPrice:ex,
      entryTime:b.time, entry, sl, tp, risk, reward, rr:reward/risk,
      outcome, exitTime:exitIdx>=0?bars[exitIdx].time:null,
      exit, R:exit==null?null:(exit-entry)*dir/risk
    };
  }

  const api={WINDOWS,ENTRY_END_MIN,nyInfo,analyse};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.BRCbdr=api;
})(typeof window!=='undefined'?window:globalThis);
