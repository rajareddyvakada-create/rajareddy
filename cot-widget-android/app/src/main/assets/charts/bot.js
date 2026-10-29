// Ox Alpha bot: opens a practice trade by itself when the chosen indicator fires a BUY / SELL on a closed candle,
// with a fixed stop-loss and target (like an Expert Advisor on MT5 desktop). Brokers don't let other apps send real
// orders, so for XM / Octa it notifies you with the exact levels to place.
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const PFX = 'bot.';
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(PFX + k)); return v == null ? d : v; } catch(e){ return d; } };
  const save = (k, v) => { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch(e){} };
  const API = () => window.ChartAPI;
  const DEF = { on:false, source:'ox', when:'live', slMode:'indicator', slAtr:1.5, slFixed:5, tpR:1.5, trail:false, reverse:true, maxDay:5 };
  const cfg = Object.assign({}, DEF, load('cfg', {}));
  let lastKey = load('last', ''), log = load('log', []);

  function note(text){
    log.unshift({ t:Date.now(), text }); log = log.slice(0, 30); save('log', log);
    if($('botDlg').open) renderLog();
  }
  function atr14(c){
    const n = c.length; if(n < 15) return NaN;
    let r = 0;
    for(let i = 1; i < n; i++){ const tr = Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); r = i <= 14 ? r + tr / 14 : (r * 13 + tr) / 14; }
    return r;
  }
  function status(text){ $('botBtn').title = text; $('botState').textContent = text; }

  // Runs after every closed candle (chart:candle event).
  function onCandle(){
    const st = API().state();
    $('botBtn').setAttribute('aria-pressed', String(cfg.on));
    if(!cfg.on) return status('Bot is off.');
    if(st.demo) return status('Paused: the chart shows demo (random) prices.');
    const c = st.candles, n = c.length;
    if(n < 20) return status('Waiting for candles.');
    const liveNow = st.online && st.live;
    if(cfg.when === 'live' && !liveNow) return status('Waiting: works on the live chart only (change in bot settings to also trade replay).');
    if(liveNow && st.feed !== 'live') return status('Paused: no new price (market closed or feed stalled).');
    const last = c[n - 1];
    // Live: only a signal on the candle that just closed (not an old one shown again after a timeframe switch).
    if(liveNow){ const nowWall = Date.now() / 1000 - new Date().getTimezoneOffset() * 60; if(nowWall - (last.time + st.tf) > st.tf + 5) return status('Watching: waiting for the next candle to close.'); }
    const sig = (st.signals || []).filter(s => s.src === cfg.source && s.time === last.time).pop();
    status('Watching ' + srcName(cfg.source) + ' on ' + st.name + ' ' + st.tfLabel + '.');
    if(!sig) return;
    const key = st.name + '|' + st.tfLabel + '|' + sig.time + '|' + sig.side;
    if(key === lastKey) return;
    lastKey = key; save('last', key);
    const side = sig.side === 'buy' ? 'long' : 'short', dir = side === 'long' ? 1 : -1;

    if(st.pos){
      if(st.pos.side === side) return note('Skipped ' + sig.side.toUpperCase() + ': already ' + side + '.');
      if(!cfg.reverse) return note('Skipped ' + sig.side.toUpperCase() + ': a ' + st.pos.side + ' is open (reverse is off).');
      API().close();
      note('Closed the ' + st.pos.side + ' on the opposite signal.');
    }
    const day = new Date().toDateString();
    const today = (API().state().trades || []).filter(t => t.by === 'Bot' && new Date((t.openedAt || 0)).toDateString() === day).length;
    if(today >= cfg.maxDay) return note('Skipped: daily limit of ' + cfg.maxDay + ' bot trades reached.');

    const price = st.price, a = atr14(c);
    let sl;
    if(cfg.slMode === 'indicator' && sig.sl != null && (price - sig.sl) * dir > 0) sl = sig.sl;
    else if(cfg.slMode === 'fixed') sl = price - dir * cfg.slFixed;
    else sl = price - dir * cfg.slAtr * a;
    if(!isFinite(sl)) return note('Skipped: no stop could be set (not enough candles for ATR).');
    const tp = sig.tp != null && (sig.tp - price) * dir > 0 && cfg.slMode === 'indicator' ? sig.tp : price + dir * Math.abs(price - sl) * cfg.tpR;
    const v = Core.validateProposal({ side, sl, tp }, st);
    if(!v.ok) return note('Not placed: ' + v.errors.join(' '));
    const ok = side === 'long' ? API().buy({ sl:v.sl, tp:v.tp, by:'Bot', trail:cfg.trail }) : API().sell({ sl:v.sl, tp:v.tp, by:'Bot', trail:cfg.trail });
    if(!ok) return note('Not placed: the chart refused the levels.');
    const p = API().state().pos, dp = st.precision;
    const msg = (side === 'long' ? 'BUY ' : 'SELL ') + st.name + ' @ ' + p.entry.toFixed(dp) + ' · SL ' + p.sl.toFixed(dp) + ' · TP ' + p.tp.toFixed(dp);
    note('Opened ' + msg + ' (practice).');
    API().flash('Ox Alpha bot: ' + msg);
    if(liveNow) try { window.parent.postMessage({ type:'agentTrade', title:'Ox Alpha bot ' + (side === 'long' ? 'BUY ' : 'SELL ') + st.name, body:msg + '. Practice trade opened; place it in MT5 for your real account.' }, '*'); } catch(e){}
  }

  /* ---------- settings sheet ---------- */
  function sources(){
    const st = API().state(), names = {};
    for(const s of st.indicators || []) names[s.id] = s.name;
    return names;
  }
  const srcName = id => sources()[id] || id;
  function renderLog(){
    $('botLog').innerHTML = log.length ? log.map(l => '<li><small>' + new Date(l.t).toLocaleString([], { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) + '</small> ' + l.text.replace(/[&<>]/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[ch])) + '</li>').join('') : '<li>No bot activity yet.</li>';
  }
  function openDlg(){
    const sel = $('botSource'); sel.innerHTML = '';
    for(const [id, name] of Object.entries(sources())){ const o = document.createElement('option'); o.value = id; o.textContent = name; sel.appendChild(o); }
    sel.value = cfg.source;
    $('botOn').checked = cfg.on; $('botWhen').value = cfg.when; $('botSlMode').value = cfg.slMode; $('botSlAtr').value = cfg.slAtr;
    $('botSlFixed').value = cfg.slFixed; $('botTpR').value = cfg.tpR; $('botTrail').checked = cfg.trail; $('botReverse').checked = cfg.reverse; $('botMaxDay').value = cfg.maxDay;
    $('botErr').hidden = true; renderLog(); $('botDlg').showModal();
  }
  function saveDlg(){
    const num = (id, min, max) => { const v = parseFloat($(id).value); return isFinite(v) && v >= min && v <= max ? v : null; };
    const v = { on:$('botOn').checked, source:$('botSource').value || 'ox', when:$('botWhen').value, slMode:$('botSlMode').value,
      slAtr:num('botSlAtr', 0.1, 20), slFixed:num('botSlFixed', 0.00001, 1e9), tpR:num('botTpR', 0.2, 20), trail:$('botTrail').checked, reverse:$('botReverse').checked, maxDay:num('botMaxDay', 1, 100) };
    if([v.slAtr, v.slFixed, v.tpR, v.maxDay].some(x => x == null)){ $('botErr').textContent = 'Check the numbers: ATR 0.1–20, target 0.2–20 R, 1–100 trades a day, distance above 0.'; $('botErr').hidden = false; return; }
    const was = cfg.on;
    Object.assign(cfg, v); save('cfg', cfg);
    if(cfg.on && !was){ lastKey = ''; note('Bot switched on: ' + srcName(cfg.source) + ', ' + (cfg.when === 'live' ? 'live chart only' : 'live and replay') + '.'); }
    if(!cfg.on && was) note('Bot switched off.');
    $('botDlg').close(); onCandle();
  }
  $('botBtn').addEventListener('click', openDlg);
  $('botSave').addEventListener('click', saveDlg);
  window.addEventListener('chart:candle', onCandle);
  $('botBtn').setAttribute('aria-pressed', String(cfg.on));
  window.OxBot = { cfg, onCandle };
})();
