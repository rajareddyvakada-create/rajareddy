// Online price data for Bar Replay: history + live updates.
// Bars are returned in "wall clock" seconds for this computer's time zone.
(function(){
  'use strict';
  const toLocalWall = s => s - new Date(s * 1000).getTimezoneOffset() * 60;
  const decimals = s => { const t = String(s); return t.includes('.') ? (t.replace(/0+$/, '').split('.')[1] || '').length : 0; };
  const precisionOf = list => Math.min(Math.max(list.reduce((p, s) => Math.max(p, decimals(s)), 0), 2), 5);

  /* ---------- Binance (public, no key) ---------- */
  const BIN_REST = ['https://data-api.binance.vision', 'https://api.binance.com'];
  const BIN_WS = ['wss://data-stream.binance.vision/ws/', 'wss://stream.binance.com:9443/ws/'];
  const binSym = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const binBar = k => ({ time:toLocalWall(Math.floor(k[0] / 1000)), open:+k[1], high:+k[2], low:+k[3], close:+k[4] });

  async function binJSON(path){
    let msg = '';
    for(const base of BIN_REST){
      try {
        const r = await fetch(base + path);
        const j = await r.json().catch(() => null);
        if(r.ok) return j;
        msg = (j && j.msg) || ('HTTP ' + r.status);
        if(r.status === 400) break; // e.g. unknown symbol: every host gives the same answer
      } catch(e){ if(!msg) msg = 'network'; }
    }
    throw new Error(msg === 'network' ? 'Couldn’t reach Binance. Check your internet connection.' : 'Binance: ' + msg);
  }

  async function loadBinance(src){
    const sym = binSym(src.symbol);
    if(!sym) throw new Error('Enter a Binance symbol, for example PAXGUSDT.');
    let start = Date.now() - src.days * 86400000;
    const raw = [];
    for(let i = 0; i < 20; i++){
      const k = await binJSON(`/api/v3/klines?symbol=${sym}&interval=1m&limit=1000&startTime=${start}`);
      if(!Array.isArray(k) || !k.length) break;
      for(const x of k) raw.push(x);
      start = k[k.length - 1][0] + 60000;
      if(k.length < 1000) break;
    }
    if(raw.length < 2) throw new Error('Binance returned no price data for ' + sym + '.');
    return { bars:raw.map(binBar), precision:precisionOf(raw.slice(-300).map(k => k[4])), name:`${sym} (Binance)`, lastMs:raw[raw.length - 1][0] };
  }

  function streamBinance(src, info, onBars, onState){
    const sym = binSym(src.symbol);
    let ws = null, stopped = false, tries = 0, timer = 0, host = 0, lastMs = info.lastMs || Date.now() - 120000;
    async function fillGap(){
      try {
        const k = await binJSON(`/api/v3/klines?symbol=${sym}&interval=1m&limit=1000&startTime=${lastMs}`);
        if(!stopped && Array.isArray(k) && k.length){ lastMs = k[k.length - 1][0]; onBars(k.map(binBar)); }
      } catch(e){}
    }
    function retry(){
      onState('off');
      tries++;
      timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(tries, 5)));
    }
    function connect(){
      if(stopped) return;
      onState('connecting');
      let opened = false;
      try { ws = new WebSocket(BIN_WS[host] + sym.toLowerCase() + '@kline_1m'); }
      catch(e){ host = (host + 1) % BIN_WS.length; retry(); return; }
      ws.onopen = () => { opened = true; tries = 0; onState('on'); fillGap(); };
      ws.onmessage = e => {
        try {
          const k = JSON.parse(e.data).k;
          if(!k) return;
          lastMs = k.t;
          onBars([{ time:toLocalWall(Math.floor(k.t / 1000)), open:+k.o, high:+k.h, low:+k.l, close:+k.c }]);
        } catch(err){}
      };
      ws.onerror = () => { try { ws.close(); } catch(e){} };
      ws.onclose = () => { if(stopped) return; if(!opened) host = (host + 1) % BIN_WS.length; retry(); };
    }
    connect();
    return () => { stopped = true; clearTimeout(timer); if(ws){ ws.onclose = null; try { ws.close(); } catch(e){} } };
  }


  /* ---------- Yahoo Finance (futures, indices, crypto; no key) ---------- */
  const YH = ['https://query1.finance.yahoo.com/v8/finance/chart/', 'https://query2.finance.yahoo.com/v8/finance/chart/'];
  const YRES = {
    '1m':  { interval:'1m',  range:'5d',   sec:60,    poll:20000,  live:'1d' },
    '5m':  { interval:'5m',  range:'60d',  sec:300,   poll:30000,  live:'1d' },
    '15m': { interval:'15m', range:'60d',  sec:900,   poll:45000,  live:'5d' },
    '1h':  { interval:'60m', range:'730d', sec:3600,  poll:60000,  live:'5d' },
    '1d':  { interval:'1d',  range:'10y',  sec:86400, poll:300000, live:'1mo' }
  };
  async function yhGet(symbol, interval, range){
    let msg = '';
    for(const base of YH){
      try {
        const r = await fetch(base + encodeURIComponent(symbol) + '?interval=' + interval + '&range=' + range + '&includePrePost=false');
        const j = await r.json().catch(() => null);
        const res = j && j.chart && j.chart.result && j.chart.result[0];
        if(r.ok && res && res.timestamp) return res;
        msg = (j && j.chart && j.chart.error && j.chart.error.description) || (r.ok ? 'no price data returned' : 'HTTP ' + r.status);
        if(r.status === 404) break;
      } catch(e){ if(!msg) msg = 'network'; }
    }
    throw new Error(msg === 'network' ? 'Couldn’t reach Yahoo Finance. Check your internet connection.' : 'Yahoo Finance: ' + msg + '.');
  }
  // Intraday bars snap to the interval and show in local time; daily bars keep the exchange's calendar date.
  function yhBars(res, sec){
    const ts = res.timestamp || [], q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
    const off = (res.meta && res.meta.gmtoffset) || 0, out = [];
    for(let i = 0; i < ts.length; i++){
      const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
      if([o, h, l, c].some(v => v == null || !isFinite(v))) continue;
      const time = sec >= 86400 ? Math.floor((ts[i] + off) / 86400) * 86400 : toLocalWall(ts[i] - (((ts[i] % sec) + sec) % sec));
      const b = { time, open:o, high:Math.max(h, o, c), low:Math.min(l, o, c), close:c };
      const last = out[out.length - 1];
      if(last && last.time === time){ last.high = Math.max(last.high, b.high); last.low = Math.min(last.low, b.low); last.close = c; }
      else if(!last || time > last.time) out.push(b);
    }
    return out;
  }
  async function loadYahoo(src){
    const R = YRES[src.res] || YRES['1m'];
    if(!src.symbol) throw new Error('Choose a market or enter a Yahoo Finance symbol, for example GC=F.');
    const res = await yhGet(src.symbol, R.interval, R.range);
    const bars = yhBars(res, R.sec);
    if(bars.length < 2) throw new Error('Yahoo Finance returned no price data for ' + src.symbol + '.');
    const hint = res.meta && res.meta.priceHint;
    const precision = Math.min(Math.max(isFinite(hint) ? hint : precisionOf(bars.slice(-300).map(b => b.close)), 2), 5);
    return { bars, precision, name:`${src.label || src.symbol} · ${src.res || '1m'}` };
  }
  function streamYahoo(src, info, onBars, onState){
    const R = YRES[src.res] || YRES['1m'];
    let stopped = false, timer = 0;
    async function poll(){
      if(stopped) return;
      try {
        const res = await yhGet(src.symbol, R.interval, R.live);
        if(stopped) return;
        onBars(yhBars(res, R.sec).slice(-5));
        onState('on');
      } catch(e){ if(!stopped) onState('off'); }
      if(!stopped) timer = setTimeout(poll, R.poll);
    }
    onState('on');
    timer = setTimeout(poll, R.poll);
    return () => { stopped = true; clearTimeout(timer); };
  }

  /* ---------- Twelve Data (free API key) ---------- */
  const TD = 'https://api.twelvedata.com/time_series?';
  function tdBar(v){
    const [d, t = '0:0:0'] = String(v.datetime).split(' ');
    const [Y, M, D] = d.split('-').map(Number);
    const [h, mi, s] = t.split(':').map(Number);
    return { time:toLocalWall(Date.UTC(Y, M - 1, D, h || 0, mi || 0, s || 0) / 1000), open:+v.open, high:+v.high, low:+v.low, close:+v.close };
  }
  async function tdGet(params){
    let r;
    try { r = await fetch(TD + new URLSearchParams(params)); }
    catch(e){ throw new Error('Couldn’t reach Twelve Data. Check your internet connection.'); }
    const j = await r.json().catch(() => null);
    if(!j) throw new Error('Twelve Data sent a reply that couldn’t be read. Try again.');
    if(j.status === 'error' || !Array.isArray(j.values)){
      const e = new Error('Twelve Data: ' + (j.message || 'no data returned.'));
      e.code = j.code || r.status;
      throw e;
    }
    return j.values;
  }
  async function loadTwelve(src){
    if(!src.key) throw new Error('Add your Twelve Data API key first. It’s free at twelvedata.com.');
    if(!src.symbol) throw new Error('Enter a symbol, for example XAU/USD.');
    const need = src.days * 1440;
    let vals = [], end = null;
    for(let i = 0; i < 4 && vals.length < need; i++){
      const p = { symbol:src.symbol, interval:'1min', outputsize:String(Math.min(5000, need - vals.length + 1)), timezone:'UTC', apikey:src.key };
      if(end) p.end_date = end;
      let v;
      try { v = await tdGet(p); } catch(e){ if(vals.length) break; throw e; }
      if(!v.length) break;
      vals = vals.concat(v);
      end = v[v.length - 1].datetime;
      if(v.length < Number(p.outputsize)) break;
    }
    const sorted = vals.map(tdBar).filter(b => isFinite(b.time) && isFinite(b.close)).sort((a, b) => a.time - b.time);
    const bars = [];
    for(const b of sorted){ if(bars.length && bars[bars.length - 1].time === b.time) bars[bars.length - 1] = b; else bars.push(b); }
    if(bars.length < 2) throw new Error('Twelve Data returned no price data for ' + src.symbol + '.');
    return { bars, precision:precisionOf(vals.slice(0, 300).map(v => v.close)), name:`${src.symbol} (Twelve Data)` };
  }
  // Free keys allow 800 requests a day, so this polls once a minute (about 13 hours of live updates a day).
  function streamTwelve(src, info, onBars, onState){
    let stopped = false, timer = 0;
    async function poll(){
      if(stopped) return;
      try {
        const v = await tdGet({ symbol:src.symbol, interval:'1min', outputsize:'3', timezone:'UTC', apikey:src.key });
        if(stopped) return;
        onBars(v.map(tdBar).sort((a, b) => a.time - b.time));
        onState('on');
      } catch(e){ if(!stopped) onState(e.code === 429 ? 'limit' : 'off'); }
      if(!stopped) timer = setTimeout(poll, 60000 - (Date.now() % 60000) + 4000);
    }
    onState('on');
    timer = setTimeout(poll, 60000 - (Date.now() % 60000) + 4000);
    return () => { stopped = true; clearTimeout(timer); };
  }

  const LOADERS = { yahoo:loadYahoo, twelve:loadTwelve, binance:loadBinance };
  const STREAMS = { yahoo:streamYahoo, twelve:streamTwelve, binance:streamBinance };
  window.BRData = {
    load: src => (LOADERS[src.type] || loadBinance)(src),
    stream: (src, info, onBars, onState) => (STREAMS[src.type] || streamBinance)(src, info, onBars, onState)
  };
})();
