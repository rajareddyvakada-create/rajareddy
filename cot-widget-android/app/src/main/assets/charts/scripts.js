// The user's own indicator scripts. A script is JavaScript with Pine-style helpers (ta.ema, ta.crossover, …) that
// returns BUY / SELL signals, optional stops and plot lines. Scripts run in a Web Worker: no access to the page, the
// app bridge, storage or the API key, and a script that runs longer than 4 seconds is stopped.
(function(root){
  'use strict';

  /* Helpers given to scripts as `ta`. Series are arrays, oldest first, same length as the candles; NaN = no value. */
  function makeTa(bars){
    const n = bars.close.length, nan = () => new Array(n).fill(NaN);
    const ta = {
      sma(x, len){ const o = nan(); let s = 0; for(let i = 0; i < n; i++){ s += x[i]; if(i >= len) s -= x[i - len]; if(i >= len - 1) o[i] = s / len; } return o; },
      ema(x, len){ const a = 2 / (len + 1), o = nan(); let e = NaN; for(let i = 0; i < n; i++){ if(isNaN(x[i])) { o[i] = e; continue; } e = isNaN(e) ? x[i] : a * x[i] + (1 - a) * e; o[i] = e; } return o; },
      rma(x, len){ const o = nan(); let s = 0, r = NaN; for(let i = 0; i < n; i++){ if(i < len){ s += x[i]; if(i === len - 1) r = s / len; } else r = (x[i] + (len - 1) * r) / len; o[i] = r; } return o; },
      tr(){ return bars.close.map((c, i) => i ? Math.max(bars.high[i] - bars.low[i], Math.abs(bars.high[i] - bars.close[i - 1]), Math.abs(bars.low[i] - bars.close[i - 1])) : bars.high[i] - bars.low[i]); },
      atr(len){ return ta.rma(ta.tr(), len); },
      rsi(x, len){
        const up = x.map((v, i) => i ? Math.max(v - x[i - 1], 0) : 0), dn = x.map((v, i) => i ? Math.max(x[i - 1] - v, 0) : 0);
        const u = ta.rma(up, len), d = ta.rma(dn, len);
        return u.map((v, i) => d[i] === 0 ? 100 : 100 - 100 / (1 + v / d[i]));
      },
      highest(x, len){ return x.map((_, i) => i < len - 1 ? NaN : Math.max(...x.slice(i - len + 1, i + 1))); },
      lowest(x, len){ return x.map((_, i) => i < len - 1 ? NaN : Math.min(...x.slice(i - len + 1, i + 1))); },
      change(x, len){ len = len || 1; return x.map((v, i) => i >= len ? v - x[i - len] : NaN); },
      crossover(a, b){ return a.map((v, i) => i > 0 && v > val(b, i) && a[i - 1] <= val(b, i - 1)); },
      crossunder(a, b){ return a.map((v, i) => i > 0 && v < val(b, i) && a[i - 1] >= val(b, i - 1)); },
      nz(x, y){ return x.map(v => isNaN(v) ? (y || 0) : v); },
    };
    const val = (b, i) => Array.isArray(b) ? b[i] : b;
    return ta;
  }

  /** Runs one script on candles {time, open, high, low, close, volume} (arrays). Returns plain data only. */
  function runScript(code, bars){
    const n = bars.close.length;
    const fn = new Function('bars', 'ta', '"use strict";\n' + code);
    const out = fn(bars, makeTa(bars)) || {};
    const flags = a => Array.isArray(a) ? Array.from({ length:n }, (_, i) => !!a[i]) : new Array(n).fill(false);
    const nums = a => Array.isArray(a) ? Array.from({ length:n }, (_, i) => (typeof a[i] === 'number' && isFinite(a[i]) ? a[i] : NaN)) : null;
    const plots = {};
    if(out.plots && typeof out.plots === 'object') for(const k of Object.keys(out.plots).slice(0, 6)){ const v = nums(out.plots[k]); if(v) plots[String(k).slice(0, 40)] = v; }
    return { buy:flags(out.buy), sell:flags(out.sell), sl:nums(out.sl), tp:nums(out.tp), plots };
  }

  const TEMPLATE = [
    '// Example: EMA 9 / 21 crossover. Arrays are oldest first: bars.open, bars.high, bars.low, bars.close, bars.volume, bars.time.',
    '// Helpers: ta.ema(src, len) ta.sma ta.rma ta.rsi(src, len) ta.atr(len) ta.highest(src, len) ta.lowest ta.change',
    '//          ta.crossover(a, b) ta.crossunder(a, b) ta.nz(src)',
    'const fast = ta.ema(bars.close, 9), slow = ta.ema(bars.close, 21), atr = ta.atr(14);',
    'const buy = ta.crossover(fast, slow), sell = ta.crossunder(fast, slow);',
    'return {',
    '  buy, sell,',
    '  // optional: a stop for each signal (the Ox Alpha bot uses it); otherwise the bot\'s own stop setting applies',
    '  sl: bars.close.map((c, i) => buy[i] ? c - 1.5 * atr[i] : sell[i] ? c + 1.5 * atr[i] : NaN),',
    '  plots: { "EMA 9": fast, "EMA 21": slow }',
    '};'
  ].join('\n');

  // Node tests load this file directly.
  if(typeof module !== 'undefined' && module.exports){ module.exports = { runScript, makeTa, TEMPLATE }; return; }

  /* ---------- in the app: storage, worker and indicator objects ---------- */
  const KEY = 'chart.user-scripts';
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch(e){ return []; } };
  const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch(e){ return false; } };
  const COLORS = ['#00E5FF', '#FFB300', '#B388FF', '#69F0AE', '#FF80AB', '#82B1FF'];

  const WORKER_SRC = 'const makeTa = ' + makeTa.toString() + ';\nconst runScript = ' + runScript.toString() + ';\n' +
    'onmessage = e => { const d = e.data; try { postMessage({ id:d.id, out:runScript(d.code, d.bars) }); } catch(err){ postMessage({ id:d.id, error:String(err && err.message || err) }); } };';
  let worker = null, workerUrl = null, seq = 0;
  const pending = new Map(), cache = {};
  function getWorker(){
    if(worker) return worker;
    if(!workerUrl) workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type:'text/javascript' }));
    worker = new Worker(workerUrl);
    worker.onmessage = e => { const p = pending.get(e.data.id); if(!p) return; pending.delete(e.data.id); clearTimeout(p.timer); p.done(e.data); };
    return worker;
  }
  function run(code, candles){
    return new Promise(done => {
      let w;
      try { w = getWorker(); } catch(e){ done({ error:'Scripts need Web Workers, which this device blocks.' }); return; }
      const id = ++seq, bars = { time:[], open:[], high:[], low:[], close:[], volume:[] };
      for(const c of candles){ bars.time.push(c.time); bars.open.push(c.open); bars.high.push(c.high); bars.low.push(c.low); bars.close.push(c.close); bars.volume.push(c.volume || 0); }
      const timer = setTimeout(() => {   // runaway script: stop the worker, start a fresh one next time
        pending.delete(id); try { worker.terminate(); } catch(e){} worker = null;
        done({ error:'Stopped: the script ran longer than 4 seconds.' });
      }, 4000);
      pending.set(id, { done, timer });
      w.postMessage({ id, code, bars });
    });
  }

  // An indicator object like the built-in ones. compute() answers from the last finished run and starts a new run
  // when the candles changed; when it finishes the chart recomputes (window.onChartScriptsUpdated).
  function indicatorFor(sc, k){
    const col = COLORS[k % COLORS.length];
    return {
      id:'us-' + sc.id, name:sc.name, about:'Your script', defaultOn:true, user:true, inputs:[],
      compute(c, s, pal, ctx){
        const key = ctx.tf + '|' + c.length + '|' + (c.length ? c[c.length - 1].time + ':' + c[c.length - 1].close : '');
        const ch = cache[sc.id] || (cache[sc.id] = {});
        if(ch.key !== key && ch.running !== key && c.length){
          ch.running = key;
          const times = c.map(b => b.time), closes = c.map(b => b.close);
          run(sc.code, c).then(res => {
            if(ch.running !== key) return;
            ch.running = null; ch.key = key;
            if(res.error){ ch.out = { markers:[], lines:[], panel:[{ label:sc.name, text:'Error: ' + res.error, tone:'down' }], signals:[] }; }
            else {
              const o = res.out, out = { markers:[], lines:[], panel:[], signals:[] };
              for(let i = 0; i < times.length; i++){
                const side = o.buy[i] ? 'buy' : o.sell[i] ? 'sell' : null;
                if(!side) continue;
                out.markers.push({ time:times[i], side, text:side.toUpperCase() });
                out.signals.push({ time:times[i], side, entry:closes[i], sl:o.sl && isFinite(o.sl[i]) ? o.sl[i] : null, tp:o.tp && isFinite(o.tp[i]) ? o.tp[i] : null });
              }
              Object.keys(o.plots).forEach((name, j) => out.lines.push({ id:'us-' + sc.id + '-' + j, width:2, color:j ? COLORS[(k + j) % COLORS.length] : col,
                data:times.map((t, i) => isFinite(o.plots[name][i]) ? { time:t, value:o.plots[name][i] } : { time:t }) }));
              const last = out.signals[out.signals.length - 1];
              out.panel.push({ label:sc.name, text:last ? 'last ' + last.side.toUpperCase() + ' ' + Math.round((times[times.length - 1] - last.time) / ctx.tf) + ' bars ago' : 'no signal yet', tone:last ? (last.side === 'buy' ? 'up' : 'down') : 'flat' });
              ch.out = out;
            }
            if(typeof root.onChartScriptsUpdated === 'function') root.onChartScriptsUpdated();
          });
        }
        return ch.out || { markers:[], lines:[], panel:[], signals:[] };
      }
    };
  }

  root.ChartScripts = {
    TEMPLATE, run, list:load,
    indicators(){ return load().map(indicatorFor); },
    upsert(sc){
      const list = load(), name = String(sc.name || '').trim().slice(0, 40), code = String(sc.code || '');
      if(!name) return 'Give the script a name.';
      if(!code.trim()) return 'The script is empty.';
      if(code.length > 50000) return 'The script is too long (50,000 characters max).';
      const i = list.findIndex(x => x.id === sc.id);
      const item = { id:sc.id || Date.now().toString(36), name, code };
      if(i >= 0) list[i] = item; else list.push(item);
      delete cache[item.id];
      return save(list) ? null : 'Couldn\'t save (storage full or blocked).';
    },
    remove(id){ delete cache[id]; return save(load().filter(x => x.id !== id)); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
