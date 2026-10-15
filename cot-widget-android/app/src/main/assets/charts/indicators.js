// Chart indicators. Each one lists its settings (they become toggles and fields in the
// Indicators panel) and computes signals from closed candles only, so replay never repaints.
// compute(candles, settings) returns { markers:[{time, side:'buy'|'sell', text}], lines:[{id, width, data:[{time, value, color?}]}] }
(function(){
  'use strict';

  function rmaATR(c, period){
    const P = Math.max(1, Math.round(period)), out = new Array(c.length).fill(NaN);
    let sum = 0, atr = NaN;
    for(let i = 0; i < c.length; i++){
      const b = c[i], pc = i ? c[i - 1].close : NaN;
      const tr = isNaN(pc) ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
      if(i < P){ sum += tr; if(i === P - 1) atr = sum / P; }
      else atr = (tr + (P - 1) * atr) / P; // same as Pine's ta.atr (RMA seeded with an SMA)
      out[i] = atr;
    }
    return out;
  }

  function heikinAshiClose(c){
    return c.map(b => (b.open + b.high + b.low + b.close) / 4);
  }

  const UT_BOT = {
    id:'ut',
    name:'UT Bot Alerts',
    about:'ATR trailing stop. Buy when price closes above it, Sell when it closes below.',
    defaultOn:true,
    inputs:[
      { key:'key',    label:'Key value (sensitivity)', type:'number', def:1,  step:0.1, min:0.1 },
      { key:'atr',    label:'ATR period',              type:'number', def:10, step:1,   min:1, int:true },
      { key:'ha',     label:'Signals from Heikin Ashi candles', type:'bool', def:false },
      { key:'labels', label:'Show Buy and Sell labels',          type:'bool', def:true },
      { key:'line',   label:'Show trailing stop line',           type:'bool', def:true }
    ],
    compute(c, s, pal){
      const atr = rmaATR(c, s.atr), src = s.ha ? heikinAshiClose(c) : c.map(b => b.close);
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

  window.ChartIndicators = [UT_BOT];
})();
