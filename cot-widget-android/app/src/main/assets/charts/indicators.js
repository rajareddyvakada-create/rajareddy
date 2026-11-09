// Chart indicators. Each one lists its settings (they become toggles and fields in the
// Indicators panel) and computes signals from closed candles only, so replay never repaints.
// compute(candles, settings, palette, ctx) returns
//   { markers:[{time, side:'buy'|'sell', text} | {time, position, shape, color, text}],
//     lines:[{id, width, color?, data:[{time, value, color?}]}],
//     panel:[{label, text, tone:'up'|'down'|'flat'}] }
// ctx = { tf: chart timeframe in seconds, tick: price step }
(function(){
  'use strict';

  /* ---------- shared maths (same definitions as Pine) ---------- */
  function rmaATR(c, period){
    const P = Math.max(1, Math.round(period)), out = new Array(c.length).fill(NaN);
    let sum = 0, atr = NaN;
    for(let i = 0; i < c.length; i++){
      const b = c[i], pc = i ? c[i - 1].close : NaN;
      const tr = isNaN(pc) ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
      if(i < P){ sum += tr; if(i === P - 1) atr = sum / P; }
      else atr = (tr + (P - 1) * atr) / P; // ta.atr: RMA seeded with an SMA
      out[i] = atr;
    }
    return out;
  }
  function emaSeries(x, len){ // ta.ema: first value seeds the average
    const a = 2 / (len + 1), out = new Array(x.length).fill(NaN);
    let e = NaN;
    for(let i = 0; i < x.length; i++){ e = isNaN(e) ? x[i] : a * x[i] + (1 - a) * e; out[i] = e; }
    return out;
  }
  function smaSeries(x, len){
    const out = new Array(x.length).fill(NaN);
    let s = 0;
    for(let i = 0; i < x.length; i++){ s += x[i]; if(i >= len) s -= x[i - len]; if(i >= len - 1) out[i] = s / len; }
    return out;
  }
  const hiOf = (c, a, b) => { let m = -Infinity; for(let j = Math.max(0, a); j <= b; j++) if(c[j].high > m) m = c[j].high; return m; };
  const loOf = (c, a, b) => { let m = Infinity; for(let j = Math.max(0, a); j <= b; j++) if(c[j].low < m) m = c[j].low; return m; };
  const vol = b => b.volume > 0 ? b.volume : 0;

  // UT Bot trailing stop and position, exactly as f_ut() in the Pine script
  function utBot(c, key, atrP, ha){
    const atr = rmaATR(c, atrP), n = c.length, stop = new Array(n).fill(NaN), pos = new Array(n).fill(0);
    const src = c.map(b => ha ? (b.open + b.high + b.low + b.close) / 4 : b.close);
    for(let i = 0; i < n; i++){
      const x = src[i], px = i ? src[i - 1] : NaN, prev = i && !isNaN(stop[i - 1]) ? stop[i - 1] : 0, nLoss = key * atr[i];
      let s;
      if(x > prev && px > prev) s = Math.max(prev, x - nLoss);
      else if(x < prev && px < prev) s = Math.min(prev, x + nLoss);
      else s = x > prev ? x - nLoss : x + nLoss;
      stop[i] = s;
      pos[i] = px < prev && x > prev ? 1 : px > prev && x < prev ? -1 : (i ? pos[i - 1] : 0);
    }
    return { stop, pos };
  }

  // Group candles into a higher timeframe. Returns the bars and, per candle, its bar index.
  function aggregate(c, sec){
    const bars = [], idx = new Array(c.length);
    for(let i = 0; i < c.length; i++){
      const b = c[i], k = b.time - (((b.time % sec) + sec) % sec), last = bars[bars.length - 1];
      if(last && last.time === k){ last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = b.close; last.volume += vol(b); }
      else bars.push({ time:k, open:b.open, high:b.high, low:b.low, close:b.close, volume:vol(b) });
      idx[i] = bars.length - 1;
    }
    return { bars, idx };
  }

  /* ---------- swing reversal gate (new) ----------
     A SELL is allowed only at the end of an up swing: the highest high of the last L bars
     formed 1..maxAge bars ago, the leg into it was at least minLeg x ATR, and price has
     turned down at least minTurn x ATR but not more than maxRetr % of that leg.
     A BUY is the mirror at a swing low. Everything in the middle of a range is blocked. */
  function swingGate(c, i, atr, g){
    const L = g.len;
    if(i < 2 * L || isNaN(atr)) return { buy:false, sell:false, ok:false };
    let hiI = i - L + 1, loI = hiI;
    for(let j = i - L + 1; j <= i; j++){ if(c[j].high >= c[hiI].high) hiI = j; if(c[j].low <= c[loI].low) loI = j; }
    const hi = c[hiI].high, lo = c[loI].low, hiAgo = i - hiI, loAgo = i - loI, close = c[i].close;
    const legUp = hi - loOf(c, hiI - L, hiI - 1), turnDn = hi - close;
    const legDn = hiOf(c, loI - L, loI - 1) - lo, turnUp = close - lo;
    const sell = hiAgo >= 1 && hiAgo <= g.age && legUp >= g.leg * atr && turnDn >= g.turn * atr && turnDn <= legUp * g.retr / 100;
    const buy  = loAgo >= 1 && loAgo <= g.age && legDn >= g.leg * atr && turnUp >= g.turn * atr && turnUp <= legDn * g.retr / 100;
    return { buy, sell, ok:true, hiAgo, loAgo, pos: hi > lo ? (close - lo) / (hi - lo) * 100 : 50 };
  }

  const TF = { chart:0, '15m':900, '30m':1800, '1h':3600, '4h':14400 };
  const GATE_TFS = [900, 1800, 3600, 14400];
  const tfName = s => s >= 14400 ? (s / 3600) + 'h' : s >= 3600 ? (s / 3600) + 'h' : (s / 60) + 'm';

  /* ---------- Ox Alpha SMC Pro (merged Ox Alpha UT Pro + Claude SMC Engine) ---------- */
  const OX = {
    id:'ox',
    name:'Ox Alpha SMC Pro',
    about:'UT Bot direction, confirmed by structure, CVD, POC side and the swing-reversal gate. One signal per UT leg. SMC structure marks included.',
    defaultOn:true,
    inputs:[
      { type:'heading', label:'UT Bot engine' },
      { key:'utTf',   label:'UT timeframe', type:'select', def:'30m', options:[['chart','Chart'],['15m','15m'],['30m','30m'],['1h','1h'],['4h','4h']] },
      { key:'utKey',  label:'Key value (sensitivity)', type:'number', def:1, step:0.1, min:0.1 },
      { key:'utAtr',  label:'ATR period', type:'number', def:10, step:1, min:1, int:true },
      { key:'utHA',   label:'Use Heikin Ashi close (ohlc4)', type:'bool', def:false },
      { key:'showStop', label:'Show UT trailing stop line', type:'bool', def:true },
      { type:'heading', label:'Signal filters' },
      { key:'useStruct', label:'Structure filter', type:'bool', def:true },
      { key:'swingLen',  label:'Structure swing length', type:'number', def:24, step:1, min:2, int:true },
      { key:'useCvd',    label:'CVD filter', type:'bool', def:true },
      { key:'cvdLen',    label:'CVD smoothing', type:'number', def:21, step:1, min:2, int:true },
      { key:'usePoc',    label:'POC side filter', type:'bool', def:true },
      { key:'useUt2',    label:'Slow UT trend filter', type:'bool', def:false },
      { key:'ut2Key',    label:'Slow UT key', type:'number', def:3, step:0.1, min:0.1 },
      { key:'ut2Atr',    label:'Slow UT ATR', type:'number', def:30, step:1, min:1, int:true },
      { key:'usePoi',    label:'POI filter (FVG / order block / sweep)', type:'bool', def:false },
      { key:'poiLen',    label:'POI sweep lookback', type:'number', def:3, step:1, min:1, int:true },
      { key:'waitBars',  label:'Wait for filters (bars)', type:'number', def:20, step:1, min:0, int:true },
      { key:'showBlock', label:'Mark filtered-out flips (×)', type:'bool', def:true },
      { type:'heading', label:'Swing reversal gate (15m · 30m · 1h · 4h only)' },
      { key:'useGate',  label:'Only fire at swing reversals', type:'bool', def:true },
      { key:'gateLen',  label:'Swing length (sweet spot)', type:'number', def:24, step:1, min:5, int:true },
      { key:'gateAge',  label:'Swing end within (bars)', type:'number', def:10, step:1, min:1, int:true },
      { key:'gateLeg',  label:'Minimum swing leg (× ATR)', type:'number', def:2, step:0.1, min:0.5 },
      { key:'gateTurn', label:'Minimum turn from the end (× ATR)', type:'number', def:0.3, step:0.1, min:0 },
      { key:'gateRetr', label:'Maximum pullback (% of leg)', type:'number', def:60, step:5, min:10 },
      { key:'showPanel', label:'Show live multi-swing analyzer', type:'bool', def:true },
      { type:'heading', label:'Levels and SMC structure' },
      { key:'showPoc',  label:'Show session POC', type:'bool', def:true },
      { key:'showPd',   label:'Show previous day high / low', type:'bool', def:false },
      { key:'smcLabels', label:'HH / HL / LH / LL labels', type:'bool', def:false },
      { key:'smcBreaks', label:'BOS / CHoCH marks', type:'bool', def:false },
      { key:'smcLen',   label:'SMC swing length', type:'number', def:7, step:1, min:2, int:true },
      { key:'labels',   label:'Show BUY / SELL labels', type:'bool', def:true },
      { type:'heading', label:'Trade management (auto trailing SL)' },
      { key:'useTrail', label:'Auto trailing stop-loss on signals', type:'bool', def:true },
      { key:'trailMode', label:'Trail mode', type:'select', def:'swing', options:[['swing','Swing low / high'],['ut','UT trailing stop'],['atr','ATR chandelier']] },
      { key:'slInit',   label:'Initial stop', type:'select', def:'ut', options:[['ut','UT stop'],['atr','1.5 × ATR']] },
      { key:'beR',      label:'Break-even at (R)', type:'number', def:1, step:0.1, min:0.1 },
      { key:'tp1R',     label:'TP1 at (R)', type:'number', def:1.5, step:0.1, min:0.2 },
      { key:'lockR',    label:'Lock at TP1 (R)', type:'number', def:0.5, step:0.1, min:0 },
      { key:'tp3R',     label:'Final target TP3 (R)', type:'number', def:4, step:0.5, min:0.5 },
      { key:'swingPiv', label:'Swing trail pivot (bars each side)', type:'number', def:5, step:1, min:2, int:true },
      { key:'trailBuf', label:'Trail buffer (× ATR)', type:'number', def:0.2, step:0.05, min:0 },
      { key:'chandMult', label:'Chandelier distance (× ATR)', type:'number', def:2.5, step:0.1, min:0.5 },
      { key:'showTrades', label:'Show trade results and SL line', type:'bool', def:true }
    ],

    compute(c, s, pal, ctx){
      const n = c.length, tf = ctx && ctx.tf || 0, tick = ctx && ctx.tick || 0.01;
      const out = { markers:[], lines:[], panel:[] };
      if(n < 3) return out;
      const atrC = rmaATR(c, 14);
      const hasVol = c.some(b => b.volume > 0);

      // 1. UT Bot, on a higher timeframe from its last CLOSED bar (no repaint)
      const utSec = TF[s.utTf] || 0, useHtf = utSec > tf && tf > 0;
      let utDir = new Array(n).fill(0), utStop = new Array(n).fill(NaN), ut2Dir = new Array(n).fill(0);
      if(useHtf){
        const h = aggregate(c, utSec), u = utBot(h.bars, s.utKey, s.utAtr, s.utHA), u2 = utBot(h.bars, s.ut2Key, s.ut2Atr, s.utHA);
        for(let i = 0; i < n; i++){ const k = h.idx[i] - 1; if(k >= 0){ utDir[i] = u.pos[k]; utStop[i] = u.stop[k]; ut2Dir[i] = u2.pos[k]; } }
      } else {
        const u = utBot(c, s.utKey, s.utAtr, s.utHA), u2 = utBot(c, s.ut2Key, s.ut2Atr, s.utHA);
        utDir = u.pos; utStop = u.stop; ut2Dir = u2.pos;
      }

      // 2a. structure, 2b. CVD (estimated from where each candle closed in its range)
      const cvd = new Array(n);
      let cum = 0;
      for(let i = 0; i < n; i++){ const b = c[i], r = b.high - b.low; cum += r > 0 ? vol(b) * ((b.close - b.low) - (b.high - b.close)) / r : 0; cvd[i] = cum; }
      const cvdEma = emaSeries(cvd, s.cvdLen);

      // 2c. session volume profile POC (buckets anchored at each day's open)
      const poc = new Array(n).fill(NaN), newDayArr = new Array(n).fill(false);
      let vp = new Map(), anchor = NaN, bin = NaN, minK, maxK, pocK, tot = 0;
      const fv = k => vp.get(k) || 0;
      for(let i = 0; i < n; i++){
        const b = c[i], nd = i === 0 || Math.floor(b.time / 86400) !== Math.floor(c[i - 1].time / 86400);
        newDayArr[i] = nd;
        if(nd || isNaN(anchor)){
          vp = new Map(); anchor = b.open; bin = Math.max((isNaN(atrC[i]) ? b.high - b.low : atrC[i]) * 0.5, tick);
          minK = maxK = pocK = undefined; tot = 0;
        }
        const k = Math.floor((b.close - anchor) / bin), kv = fv(k) + vol(b);
        vp.set(k, kv); tot += vol(b);
        minK = minK === undefined ? k : Math.min(minK, k); maxK = maxK === undefined ? k : Math.max(maxK, k);
        if(kv > (pocK === undefined ? -1 : fv(pocK))) pocK = k;
        poc[i] = anchor + (pocK + 0.5) * bin;
      }

      // 2d. POI: fair value gaps, order blocks, liquidity sweeps
      const volSma = smaSeries(c.map(vol), 20);
      let fBL = NaN, fBH = NaN, fSL = NaN, fSH = NaN, oBL = NaN, oBH = NaN, oSL = NaN, oSH = NaN;
      const poiB = new Array(n).fill(false), poiS = new Array(n).fill(false);
      for(let i = 0; i < n; i++){
        const b = c[i], a = atrC[i];
        if(i >= 2 && b.low > c[i - 2].high){ fBL = c[i - 2].high; fBH = b.low; }
        if(i >= 2 && b.high < c[i - 2].low){ fSL = b.high; fSH = c[i - 2].low; }
        if(!isNaN(fBL) && b.close < fBL){ fBL = fBH = NaN; }
        if(!isNaN(fSH) && b.close > fSH){ fSL = fSH = NaN; }
        if(b.close < b.open && vol(b) > volSma[i] * 1.5){ oSL = b.low; oSH = b.high; }
        if(b.close > b.open && vol(b) > volSma[i] * 1.5){ oBL = b.low; oBH = b.high; }
        if(!isNaN(oSH) && b.close > oSH){ oSL = oSH = NaN; }
        if(!isNaN(oBL) && b.close < oBL){ oBL = oBH = NaN; }
        const refL = i >= 2 ? loOf(c, i - 2 - s.poiLen + 1, i - 2) : NaN, refH = i >= 2 ? hiOf(c, i - 2 - s.poiLen + 1, i - 2) : NaN;
        poiB[i] = (b.low <= fBH && b.low >= fBL - a) || (b.low <= oBH + a && b.low >= oBL - a) || (b.low < refL && b.close > refL);
        poiS[i] = (b.high >= fSL && b.high <= fSH + a) || (b.high >= oSL - a && b.high <= oSH + a) || (b.high > refH && b.close < refH);
      }

      // 4. filters + one signal per UT leg (the leg waits for the filters to agree)
      const gateActive = s.useGate && GATE_TFS.includes(tf);
      const G = { len:s.gateLen, age:s.gateAge, leg:s.gateLeg, turn:s.gateTurn, retr:s.gateRetr };
      let structDir = 0, legDir = 0, legBar = -1, legDone = true;
      const sigs = [];
      const blocked = pal.muted || '#8b93a7';
      for(let i = 0; i < n; i++){
        const b = c[i];
        if(i >= s.swingLen){
          const sh = hiOf(c, i - s.swingLen, i - 1), sl = loOf(c, i - s.swingLen, i - 1);
          if(b.close > sh) structDir = 1; else if(b.close < sl) structDir = -1;
        }
        const flipUp = utDir[i] === 1 && (i ? utDir[i - 1] : 0) !== 1;
        const flipDn = utDir[i] === -1 && (i ? utDir[i - 1] : 0) !== -1;
        const legOver = !legDone && (flipUp || flipDn || i - legBar > s.waitBars);
        if(legOver && s.showBlock && s.labels) out.markers.push({ time:c[legBar].time, position:legDir === 1 ? 'belowBar' : 'aboveBar', shape:'circle', color:blocked, text:'×' });
        if(legOver) legDone = true;
        if(flipUp || flipDn){ legDir = flipUp ? 1 : -1; legBar = i; legDone = false; }
        if(legDone || i - legBar > s.waitBars) continue;

        const cvdOk = !hasVol;
        const g = gateActive ? swingGate(c, i, atrC[i], G) : null;
        const passBuy = (!s.useStruct || structDir === 1) && (!s.useCvd || cvdOk || cvd[i] > cvdEma[i]) && (!s.usePoc || !hasVol || b.close > poc[i])
          && (!s.useUt2 || ut2Dir[i] === 1) && (!s.usePoi || poiB[i]) && (!gateActive || g.buy);
        const passSell = (!s.useStruct || structDir === -1) && (!s.useCvd || cvdOk || cvd[i] < cvdEma[i]) && (!s.usePoc || !hasVol || b.close < poc[i])
          && (!s.useUt2 || ut2Dir[i] === -1) && (!s.usePoi || poiS[i]) && (!gateActive || g.sell);
        const buy = legDir === 1 && utDir[i] === 1 && passBuy, sell = legDir === -1 && utDir[i] === -1 && passSell;
        if(buy || sell){
          legDone = true;
          sigs.push({ i, dir:buy ? 1 : -1 });
          if(s.labels) out.markers.push({ time:b.time, side:buy ? 'buy' : 'sell', text:buy ? 'BUY' : 'SELL' });
        }
      }

      // Every signal with the indicator's own initial stop (same rule as the trade manager), for the Ox Alpha bot
      out.signals = sigs.filter(x => !isNaN(atrC[x.i])).map(({ i, dir }) => {
        const e = c[i].close, u = utStop[i];
        const sl = s.slInit === 'ut' && !isNaN(u) && (dir === 1 ? u < e : u > e) ? u : e - dir * 1.5 * atrC[i];
        return { time:c[i].time, side:dir === 1 ? 'buy' : 'sell', entry:e, sl, tp1R:s.tp1R, tp3R:s.tp3R };
      });

      // lines
      if(s.showStop){
        const d = [];
        for(let i = 0; i < n; i++) if(!isNaN(utStop[i]) && utDir[i] !== 0) d.push({ time:c[i].time, value:utStop[i], color:utDir[i] === 1 ? pal.up : pal.down });
        out.lines.push({ id:'ox-stop', width:2, data:d });
      }
      if(s.showPoc && hasVol){
        const d = [];
        for(let i = 0; i < n; i++) d.push(newDayArr[i] ? { time:c[i].time } : { time:c[i].time, value:poc[i] });
        out.lines.push({ id:'ox-poc', width:2, color:'#e3b341', data:d });
      }
      if(s.showPd){
        const dh = [], dl = [];
        let curH = -Infinity, curL = Infinity, pdh = NaN, pdl = NaN;
        for(let i = 0; i < n; i++){
          if(newDayArr[i] && i){ pdh = curH; pdl = curL; curH = -Infinity; curL = Infinity; }
          curH = Math.max(curH, c[i].high); curL = Math.min(curL, c[i].low);
          dh.push(isNaN(pdh) || newDayArr[i] ? { time:c[i].time } : { time:c[i].time, value:pdh });
          dl.push(isNaN(pdl) || newDayArr[i] ? { time:c[i].time } : { time:c[i].time, value:pdl });
        }
        out.lines.push({ id:'ox-pdh', width:1, color:'#5b8def', data:dh }, { id:'ox-pdl', width:1, color:'#5b8def', data:dl });
      }

      if(s.useTrail && sigs.length) manageTrades(c, sigs, s, pal, atrC, utDir, utStop, out);

      // SMC structure: swing labels and BOS / CHoCH
      if(s.smcLabels || s.smcBreaks) smcStructure(c, s.smcLen, s, pal, out.markers);

      // live multi-swing analyzer: where each timeframe sits in its current swing
      if(s.showPanel && tf > 0){
        for(const sec of GATE_TFS){
          if(sec < tf || sec % tf) continue;
          let bars = c;
          if(sec > tf){
            bars = aggregate(c, sec).bars;
            const last = c[n - 1];
            if(last.time + tf < bars[bars.length - 1].time + sec) bars = bars.slice(0, -1); // drop the unfinished bar
          }
          const a = rmaATR(bars, 14), i = bars.length - 1;
          if(i < 2 * s.gateLen){ out.panel.push({ label:tfName(sec), text:'not enough history', tone:'flat' }); continue; }
          const g = swingGate(bars, i, a[i], G);
          const rising = g.loAgo < g.hiAgo;
          let text = (rising ? '▲ rising ' : '▼ falling ') + Math.round(g.pos) + '% of swing';
          let tone = rising ? 'up' : 'down';
          if(g.sell){ text = 'Swing TOP ' + g.hiAgo + ' bars ago · sells allowed'; tone = 'down'; }
          else if(g.buy){ text = 'Swing BOTTOM ' + g.loAgo + ' bars ago · buys allowed'; tone = 'up'; }
          else if(g.pos > 35 && g.pos < 65) { text += ' · mid-range'; tone = 'flat'; }
          out.panel.push({ label:tfName(sec), text, tone });
        }
        if(!GATE_TFS.includes(tf)) out.panel.push({ label:'Gate', text:'off on ' + tfName(tf) + ' (only 15m · 30m · 1h · 4h)', tone:'flat' });
        if(!hasVol) out.panel.push({ label:'Volume', text:'none in this data · CVD and POC filters skipped', tone:'flat' });
      }
      return out;
    }
  };

  /* ---------- auto trailing stop-loss (app only) ----------
     Per signal: initial SL at the UT stop (or 1.5 ATR). At +beR the SL moves to entry + 0.1 ATR;
     at TP1 it locks +lockR; after TP1 it trails (swing pivot / UT stop / ATR chandelier).
     It only moves in the trade's favour. Exit when a candle CLOSES beyond the SL, at TP3,
     or at an opposite signal. Uses closed candles only, so replay matches live. */
  function trailSL(c, j, dir, entry, sl, R, a, mode, s, utDir, utStop, ext, piv){
    let cand = NaN;
    if(mode === 'swing'){ const pv = dir === 1 ? piv.lo[j] : piv.hi[j]; if(!isNaN(pv)) cand = dir === 1 ? pv - s.trailBuf * a : pv + s.trailBuf * a; }
    else if(mode === 'ut'){ if(utDir[j] === dir && !isNaN(utStop[j])) cand = utStop[j]; }
    else cand = dir === 1 ? ext - s.chandMult * a : ext + s.chandMult * a;
    if(isNaN(cand)) return sl;
    return dir === 1 ? Math.max(sl, cand) : Math.min(sl, cand);
  }
  function confirmedPivots(c, L){ // value known at bar j: the latest pivot confirmed by then
    const n = c.length, lo = new Array(n).fill(NaN), hi = new Array(n).fill(NaN);
    let lastLo = NaN, lastHi = NaN;
    for(let j = 0; j < n; j++){
      const p = j - L;
      if(p >= L){
        let isL = true, isH = true;
        for(let k = p - L; k <= p + L; k++){ if(k === p) continue; if(c[k].low < c[p].low) isL = false; if(c[k].high > c[p].high) isH = false; }
        if(isL) lastLo = c[p].low;
        if(isH) lastHi = c[p].high;
      }
      lo[j] = lastLo; hi[j] = lastHi;
    }
    return { lo, hi };
  }
  function manageTrades(c, sigs, s, pal, atr, utDir, utStop, out){
    const n = c.length, piv = confirmedPivots(c, s.swingPiv), slLine = [], fmtR = r => (r >= 0 ? '+' : '') + r.toFixed(1) + 'R';
    let wins = 0, total = 0, net = 0, open = null, freeFrom = 0;
    const sigAt = new Map(sigs.map(x => [x.i, x.dir]));
    for(const { i, dir } of sigs){
      if(i < freeFrom) continue; // a trade is already open: same-direction signals are ignored
      const b = c[i], a = atr[i], entry = b.close;
      if(isNaN(a)) continue;
      let sl = s.slInit === 'ut' && !isNaN(utStop[i]) && (dir === 1 ? utStop[i] < entry : utStop[i] > entry) ? utStop[i] : entry - dir * 1.5 * a;
      const R = Math.abs(entry - sl);
      if(!(R > 0)) continue;
      const tp3 = entry + dir * s.tp3R * R;
      let stage = 0, ext = dir === 1 ? b.high : b.low, exitAt = -1, exitPx = NaN, why = '';
      const col = () => stage >= 2 ? pal.up : stage === 1 ? '#e3b341' : pal.down;
      slLine.push({ time:b.time, value:sl, color:col() });
      for(let j = i + 1; j < n; j++){
        const x = c[j], aj = isNaN(atr[j]) ? a : atr[j];
        // exits first, against the stop that stood before this candle
        if(dir === 1 ? x.close < sl : x.close > sl){ exitAt = j; exitPx = x.close; why = stage >= 2 ? 'TRAIL' : stage === 1 ? 'BE' : 'SL'; }
        else if(dir === 1 ? x.high >= tp3 : x.low <= tp3){ exitAt = j; exitPx = tp3; why = 'TP3'; }
        else if(sigAt.get(j) === -dir){ exitAt = j; exitPx = x.close; why = 'FLIP'; }
        if(exitAt >= 0){ slLine.push({ time:x.time, value:sl, color:col() }); break; }
        // then move the stop for the next candle
        ext = dir === 1 ? Math.max(ext, x.high) : Math.min(ext, x.low);
        const fav = (ext - entry) * dir;
        if(stage < 1 && fav >= s.beR * R){
          sl = dir === 1 ? Math.max(sl, entry + 0.1 * aj) : Math.min(sl, entry - 0.1 * aj); stage = 1;
          if(s.showTrades) out.markers.push({ time:x.time, position:dir === 1 ? 'belowBar' : 'aboveBar', shape:'circle', color:'#e3b341', text:'BE' });
        }
        if(stage < 2 && fav >= s.tp1R * R){
          sl = dir === 1 ? Math.max(sl, entry + s.lockR * R) : Math.min(sl, entry - s.lockR * R); stage = 2;
          if(s.showTrades) out.markers.push({ time:x.time, position:dir === 1 ? 'belowBar' : 'aboveBar', shape:'circle', color:pal.up, text:'LOCK ' + fmtR(s.lockR) });
        }
        if(stage >= 2) sl = trailSL(c, j, dir, entry, sl, R, aj, s.trailMode, s, utDir, utStop, ext, piv);
        slLine.push({ time:x.time, value:sl, color:col() });
      }
      if(exitAt >= 0){
        const r = (exitPx - entry) * dir / R;
        total++; net += r; if(r > 0) wins++;
        if(s.showTrades) out.markers.push({ time:c[exitAt].time, position:dir === 1 ? 'aboveBar' : 'belowBar', shape:'square', color:r >= 0 ? pal.up : pal.down, text:why + ' ' + fmtR(r) });
        if(exitAt + 1 < n) slLine.push({ time:c[exitAt + 1].time });
        freeFrom = why === 'FLIP' ? exitAt : exitAt + 1;
      } else {
        open = { dir, entry, sl, R, stage, price:c[n - 1].close };
        freeFrom = n;
      }
    }
    if(s.showTrades){
      out.lines.push({ id:'ox-sl', width:2, data:dedupe(slLine) });
      if(s.showPanel){
        out.panel.push({ label:'Trades', text: total ? total + ' closed · ' + Math.round(100 * wins / total) + '% won · net ' + fmtR(net) : 'no closed trades yet', tone: net > 0 ? 'up' : net < 0 ? 'down' : 'flat' });
        if(open){
          const locked = (open.sl - open.entry) * open.dir / open.R, now = (open.price - open.entry) * open.dir / open.R;
          out.panel.push({ label:'Open', text:(open.dir === 1 ? 'BUY' : 'SELL') + ' ' + fmtR(now) + ' · SL ' + open.sl.toFixed(2) + ' (' + (open.stage >= 2 ? 'trailing, ' : open.stage === 1 ? 'break-even, ' : '') + fmtR(locked) + ' locked)', tone: now >= 0 ? 'up' : 'down' });
        }
      }
    }
  }
  function dedupe(d){ // one point per time; later points win
    const m = new Map();
    for(const p of d) m.set(p.time, p);
    return [...m.values()].sort((a, b) => a.time - b.time);
  }

  // Pivot-based market structure from the Claude SMC Engine
  function smcStructure(c, L, s, pal, markers){
    const n = c.length;
    let lastHigh = NaN, lastLow = NaN, hiBroken = true, loBroken = true, trend = 0;
    for(let i = 2 * L; i < n; i++){
      const p = i - L;
      let isH = true, isL = true;
      for(let j = p - L; j <= p + L; j++){
        if(j === p) continue;
        if(j < p ? c[j].high >= c[p].high : c[j].high > c[p].high) isH = false;
        if(j < p ? c[j].low <= c[p].low : c[j].low < c[p].low) isL = false;
      }
      if(isH){
        if(s.smcLabels) markers.push({ time:c[p].time, position:'aboveBar', shape:'circle', color:pal.muted || '#8b93a7', text:isNaN(lastHigh) ? 'H' : c[p].high > lastHigh ? 'HH' : 'LH' });
        lastHigh = c[p].high; hiBroken = false;
      }
      if(isL){
        if(s.smcLabels) markers.push({ time:c[p].time, position:'belowBar', shape:'circle', color:pal.muted || '#8b93a7', text:isNaN(lastLow) ? 'L' : c[p].low < lastLow ? 'LL' : 'HL' });
        lastLow = c[p].low; loBroken = false;
      }
      if(!isNaN(lastHigh) && !hiBroken && c[i].close > lastHigh){
        if(s.smcBreaks) markers.push({ time:c[i].time, position:'belowBar', shape:'square', color:pal.up, text:trend === -1 ? 'CHoCH' : 'BOS' });
        trend = 1; hiBroken = true;
      }
      if(!isNaN(lastLow) && !loBroken && c[i].close < lastLow){
        if(s.smcBreaks) markers.push({ time:c[i].time, position:'aboveBar', shape:'square', color:pal.down, text:trend === 1 ? 'CHoCH' : 'BOS' });
        trend = -1; loBroken = true;
      }
    }
  }

  /* ---------- plain UT Bot ---------- */
  const UT_BOT = {
    id:'ut',
    name:'UT Bot Alerts (basic)',
    about:'ATR trailing stop. Buy when price closes above it, Sell when it closes below.',
    defaultOn:false,
    inputs:[
      { key:'key',    label:'Key value (sensitivity)', type:'number', def:1,  step:0.1, min:0.1 },
      { key:'atr',    label:'ATR period',              type:'number', def:10, step:1,   min:1, int:true },
      { key:'ha',     label:'Signals from Heikin Ashi candles', type:'bool', def:false },
      { key:'labels', label:'Show Buy and Sell labels',          type:'bool', def:true },
      { key:'line',   label:'Show trailing stop line',           type:'bool', def:true }
    ],
    compute(c, s, pal){
      const atr = rmaATR(c, s.atr), src = s.ha ? c.map(b => (b.open + b.high + b.low + b.close) / 4) : c.map(b => b.close);
      const markers = [], line = [];
      let prevStop = 0;
      for(let i = 1; i < c.length; i++){
        if(isNaN(atr[i])) continue;
        const nLoss = s.key * atr[i], x = src[i], px = src[i - 1], ps = prevStop;
        let stop;
        if(x > ps && px > ps) stop = Math.max(ps, x - nLoss);
        else if(x < ps && px < ps) stop = Math.min(ps, x + nLoss);
        else stop = x > ps ? x - nLoss : x + nLoss;
        if(s.labels){
          if(x > stop && px <= ps) markers.push({ time:c[i].time, side:'buy', text:'BUY' });
          else if(x < stop && px >= ps) markers.push({ time:c[i].time, side:'sell', text:'SELL' });
        }
        if(ps !== 0) line.push({ time:c[i].time, value:stop, color:x > stop ? pal.up : pal.down });
        prevStop = stop;
      }
      return { markers, lines: s.line ? [{ id:'ut-stop', width:2, data:line }] : [] };
    }
  };

  window.ChartIndicators = [OX, UT_BOT];
  window.ChartIndicatorTools = { rmaATR, utBot, aggregate, swingGate };
})();
