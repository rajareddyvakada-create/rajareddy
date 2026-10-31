/* AI agent for the Charts tab.
 *
 * Built-in brain (always on, no key): reads the chart (UT trend, slow trend, EMA, structure,
 * range position, latest Ox signal), the News tab's gold verdict and the COT score, and
 * turns them into a bias, a confluence score (how far the inputs agree; not a probability of winning),
 * a ready setup (entry / SL / TP) and live guides.
 * It follows commands ("buy", "sell sl 4170", "15m", "silver", "close", "open news"...)
 * and can auto-trade its setups on the practice account.
 *
 * Optional Claude: with the user's own API key, free-form questions go to Claude, which
 * drives the app through the same actions as tools.
 *
 * Real accounts: XM and Octa (MT5) don't accept orders from other apps, so a "real order"
 * is copied to the clipboard and MT5 is opened for the user to place and confirm.
 */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const API = () => window.ChartAPI;
  const T = () => window.ChartIndicatorTools || {};
  const PFX = 'agent.';
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(PFX + k)); return v == null ? d : v; } catch(e){ return d; } };
  const save = (k, v) => { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch(e){} };
  const lsRaw = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch(e){ return d; } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const post = m => { try { window.parent.postMessage(m, '*'); } catch(e){} };
  if(!API()) return;

  const prefs = Object.assign({ on:false, auto:false, minConf:70, tpR:1.5, key:'', model:'claude-opus-5-5' }, load('prefs', {}));
  const savePrefs = () => save('prefs', prefs);
  const MARKETS = [
    ['GC=F','Gold',/\b(gold|xau|xauusd)\b/i], ['SI=F','Silver',/\b(silver|xag)\b/i], ['CL=F','Crude Oil',/\b(oil|crude|wti)\b/i],
    ['ES=F','S&P 500',/\b(s&p|spx|sp500|s and p)\b/i], ['NQ=F','Nasdaq',/\b(nasdaq|nq|ndx)\b/i], ['HG=F','Copper',/\bcopper\b/i],
    ['NG=F','Nat Gas',/\b(nat ?gas|natural gas)\b/i], ['BTC-USD','Bitcoin',/\b(bitcoin|btc)\b/i],
  ];

  /* ================= analysis ================= */
  function ema(x, len){ const a = 2 / (len + 1); let e = NaN; return x.map(v => (e = isNaN(e) ? v : a * v + (1 - a) * e)); }
  function pivots(c, L){
    const hi = [], lo = [];
    for(let i = L; i < c.length - L; i++){
      let h = true, l = true;
      for(let j = i - L; j <= i + L; j++){ if(c[j].high > c[i].high) h = false; if(c[j].low < c[i].low) l = false; }
      if(h) hi.push({ i, p:c[i].high }); if(l) lo.push({ i, p:c[i].low });
    }
    return { hi, lo };
  }
  const isGoldName = n => /gold|xau|gc=f|paxg/i.test(n || '');

  function analyze(){
    const st = API().state(), c = st.candles, n = c.length;
    if(st.demo) return { ready:false, st, why:'The chart shows demo (random) prices. Load a real market for analysis.' };
    if(n < 60 || !st.price) return { ready:false, st, why:'Waiting for enough candles (60).' };
    const tools = T(), price = st.price, dp = st.precision;
    const atr = tools.rmaATR ? tools.rmaATR(c, 14)[n - 1] : (c[n - 1].high - c[n - 1].low);
    const fast = tools.utBot ? tools.utBot(c, 1, 10, false) : null, slow = tools.utBot ? tools.utBot(c, 3, 30, false) : null;
    const closes = c.map(b => b.close), e50 = ema(closes, 50), e200 = n >= 200 ? ema(closes, 200) : null;
    const parts = [], guides = [];
    let tech = 0;
    if(fast){ const p = fast.pos[n - 1]; tech += p * 25; parts.push(['UT trend', p > 0 ? 'up' : p < 0 ? 'down' : 'flat', p * 25]); }
    if(slow){ const p = slow.pos[n - 1]; tech += p * 20; parts.push(['Slow trend', p > 0 ? 'up' : p < 0 ? 'down' : 'flat', p * 20]); }
    const above = closes[n - 1] > e50[n - 1], slope = e50[n - 1] - e50[n - 6];
    tech += (above ? 12 : -12) + (slope > 0 ? 8 : -8);
    parts.push(['EMA 50', (above ? 'price above' : 'price below') + ', ' + (slope > 0 ? 'rising' : 'falling'), (above ? 12 : -12) + (slope > 0 ? 8 : -8)]);
    if(e200){ const a2 = closes[n - 1] > e200[n - 1]; tech += a2 ? 8 : -8; parts.push(['EMA 200', a2 ? 'price above' : 'price below', a2 ? 8 : -8]); }
    const pv = pivots(c, 5), H = pv.hi.slice(-2), L = pv.lo.slice(-2);
    if(H.length === 2 && L.length === 2){
      const hh = H[1].p > H[0].p, hl = L[1].p > L[0].p;
      const s = hh && hl ? 15 : !hh && !hl ? -15 : 0;
      tech += s; parts.push(['Structure', hh && hl ? 'higher highs and lows' : !hh && !hl ? 'lower highs and lows' : 'mixed', s]);
    }
    const w = c.slice(-100), rHi = Math.max(...w.map(b => b.high)), rLo = Math.min(...w.map(b => b.low));
    const rPos = rHi > rLo ? (price - rLo) / (rHi - rLo) * 100 : 50;
    // latest Ox / indicator signal
    const times = new Map(c.map((b, i) => [b.time, i]));
    const sigs = st.markers.filter(m => m.side === 'buy' || m.side === 'sell').map(m => ({ side:m.side, i:times.get(m.time) })).filter(m => m.i != null).sort((a, b) => a.i - b.i);
    const sig = sigs[sigs.length - 1], sigAgo = sig ? n - 1 - sig.i : null;
    if(sig && sigAgo <= 5){ const s = (sig.side === 'buy' ? 1 : -1) * (sigAgo <= 1 ? 20 : 10); tech += s; parts.push(['Ox signal', sig.side.toUpperCase() + ' ' + (sigAgo ? sigAgo + ' bar' + (sigAgo > 1 ? 's' : '') + ' ago' : 'on the last candle'), s]); }
    tech = clamp(Math.round(tech), -100, 100);

    // News + COT (the News tab covers gold)
    // Missing or stale inputs are left out and listed; they never count as a neutral confirmation.
    const gold = isGoldName(st.name), missing = [];
    const nv = lsRaw('news.verdict', null), cotRaw = lsRaw('news.cot', null);
    const newsOk = gold && nv && Date.now() - nv.at < 6 * 3600e3;
    const cotAge = cotRaw ? Core.cotFreshness(cotRaw.cotDate) : null, cot = cotRaw && !cotAge.stale ? cotRaw : null;
    if(gold && !nv) missing.push('News: not loaded (open the News tab)');
    else if(gold && !newsOk) missing.push('News: older than 6 hours, left out');
    if(gold && !cotRaw) missing.push('COT: not loaded');
    else if(gold && !cot) missing.push('COT: report is ' + cotAge.ageDays + ' days old, left out');
    if(!gold) missing.push('News and COT: only available for gold');
    const feedOk = !st.live || st.feed === 'live' || st.feed === 'history';
    if(!feedOk) missing.push('Price: ' + (st.feed === 'stale' ? 'no new price (market closed or feed stalled)' : 'live feed unavailable'));
    const wT = 0.55, wN = newsOk ? 0.25 : 0, wC = gold && cot ? 0.2 : 0;
    const total = Math.round((tech * wT + (newsOk ? nv.score : 0) * wN + (wC ? cot.score : 0) * wC) / (wT + wN + wC));
    const formula = 'score = (chart × ' + wT + (wN ? ' + news × ' + wN : '') + (wC ? ' + COT × ' + wC : '') + ') ÷ ' + (wT + wN + wC).toFixed(2);
    const side = total >= 15 ? 'long' : total <= -15 ? 'short' : null;
    let conf = Core.confluence(total);
    // risk checks
    const cal = lsRaw('news.cal', { events:[] }).events || [];
    const soon = gold ? cal.filter(e => e.impact >= 80 && e.t > Date.now() && e.t - Date.now() < 60 * 60e3).sort((a, b) => a.t - b.t)[0] : null;
    if(soon){ conf -= 15; guides.push('⚠ ' + soon.title + ' in ' + Math.round((soon.t - Date.now()) / 60e3) + ' min. Spreads widen and the first spike is often fake: wait or size down.'); }
    if(side === 'long' && rPos > 75){ conf -= 10; guides.push('Price is in the top ' + Math.round(100 - rPos) + '% of its last-100-candle range (premium). Better longs come on a dip.'); }
    if(side === 'short' && rPos < 25){ conf -= 10; guides.push('Price is in the bottom ' + Math.round(rPos) + '% of its range (discount). Better shorts come on a rally.'); }
    if(newsOk && Math.abs(nv.score) >= 15 && Math.abs(tech) >= 20 && Math.sign(nv.score) !== Math.sign(tech)){ conf -= 10; guides.push('Chart and news disagree (chart ' + (tech > 0 ? 'bullish' : 'bearish') + ', news ' + nv.bias.toLowerCase() + '). Expect chop; take quick profits.'); }
    conf = clamp(conf, 30, 95);

    // Setup: stop beyond the recent swing, at least 0.6 ATR and at most 3 ATR away
    let setup = null;
    if(side && feedOk){
      const dir = side === 'long' ? 1 : -1, look = c.slice(-12);
      const swing = dir > 0 ? Math.min(...look.map(b => b.low)) : Math.max(...look.map(b => b.high));
      let sl = swing - dir * 0.2 * atr;
      let d = (price - sl) * dir;
      if(!(d >= 0.6 * atr)) d = 0.6 * atr;
      if(d > 3 * atr) d = 3 * atr;
      sl = price - dir * d;
      setup = { side, entry:price, sl:+sl.toFixed(dp), tp1:+(price + dir * d * prefs.tpR).toFixed(dp), tp2:+(price + dir * d * 3).toFixed(dp), risk:d };
    }
    // Live guide lines
    if(sig && sigAgo === 0) guides.unshift('Fresh ' + sig.side.toUpperCase() + ' signal on the candle that just closed.');
    if(fast){ const stop = fast.stop[n - 1]; guides.push('UT trailing stop at ' + stop.toFixed(dp) + ' (' + (price > stop ? 'price above it: buyers in control' : 'price below it: sellers in control') + ').'); }
    guides.push('Volatility: ATR(14) is ' + atr.toFixed(dp) + ' per ' + st.tfLabel + ' candle.');
    if(H.length && L.length) guides.push('Last confirmed swing high ' + H[H.length - 1].p.toFixed(dp) + ', swing low ' + L[L.length - 1].p.toFixed(dp) + '.');
    if(newsOk) guides.push('News verdict: ' + nv.bias + ' (' + (nv.score > 0 ? '+' : '') + nv.score + '). ' + nv.strat);
    else if(gold) guides.push('Open the News tab once so the agent can read the gold news verdict.');
    if(gold && cot) guides.push('COT positioning: ' + cot.verdict + ' (' + (cot.score > 0 ? '+' : '') + cot.score + ').');
    if(st.pos){ const p = st.pos, dir = p.side === 'long' ? 1 : -1, r = (price - p.entry) * dir / p.slDist; guides.unshift('Open ' + p.side + ' at ' + p.entry.toFixed(dp) + ': ' + (r >= 0 ? '+' : '') + r.toFixed(2) + 'R. ' + (r >= 1 ? 'Stop can sit at break-even.' : r <= -0.7 ? 'Close to the stop; don\'t widen it.' : 'Let it work; the stop is set.')); }
    if(!side) guides.unshift('No edge right now (score ' + total + '). Waiting for the trend, signal and news to line up is a valid trade.');
    if(side && !feedOk) guides.unshift('Bias only: the price isn\'t updating, so no setup until it is live again.');
    return { ready:true, st, price, atr, tech, total, side, conf, setup, parts, guides, rPos, sig, sigAgo, news:newsOk ? nv : null, cot:gold ? cot : null, gold, soon, missing, formula };
  }

  /* ================= UI ================= */
  let A = null;
  function fmt(v){ return v == null ? '—' : (+v).toFixed(A && A.st ? A.st.precision : 2); }
  function render(){
    A = analyze();
    const bar = $('agentBar');
    bar.hidden = !prefs.on;
    if(!prefs.on) return;
    if(!A.ready){ $('agHead').textContent = 'AI agent'; $('agSub').textContent = A.why || 'Waiting for enough candles…'; $('agDot').className = 'ag-dot'; if($('agentDlg').open) renderCard(); return; }
    const dirTxt = A.side === 'long' ? 'LONG bias' : A.side === 'short' ? 'SHORT bias' : 'No trade';
    $('agDot').className = 'ag-dot ' + (A.side === 'long' ? 'up' : A.side === 'short' ? 'down' : '');
    $('agHead').textContent = '🤖 ' + dirTxt + (A.side ? ' · confluence ' + A.conf + '/100' : '') + (prefs.auto ? ' · auto' : '');
    $('agSub').textContent = A.setup ? 'SL ' + fmt(A.setup.sl) + ' · TP ' + fmt(A.setup.tp1) + ' · ' + A.guides[0] : A.guides[0];
    if($('agentDlg').open) renderCard();
  }
  function renderCard(){
    if(!A || !A.ready){ $('agCard').innerHTML = '<p class="hint" style="margin:0">' + esc((A && A.why) || 'Waiting for enough candles to analyse.') + '</p>'; $('agGuides').innerHTML = ''; return; }
    const s = A.setup, cls = A.side === 'long' ? 'c-up' : A.side === 'short' ? 'c-down' : '';
    let h = '<div class="big ' + cls + '">' + (A.side === 'long' ? '▲ LONG' : A.side === 'short' ? '▼ SHORT' : '◆ NO TRADE') + (A.side ? ' · confluence ' + A.conf + '/100' : '') + '</div>' +
      '<p class="hint" style="margin:2px 0 6px">Confluence = how strongly chart, news and COT agree. It is not a probability of winning.</p>' +
      '<div class="ag-meter"><i style="left:' + (50 + A.total / 2) + '%"></i></div>' +
      '<dl class="ag-kv"><dt>Market</dt><dd>' + esc(A.st.name) + ' · ' + A.st.tfLabel + ' · ' + fmt(A.price) + '</dd><dt>Score</dt><dd>' + (A.total > 0 ? '+' : '') + A.total + ' (chart ' + (A.tech > 0 ? '+' : '') + A.tech + (A.news ? ', news ' + (A.news.score > 0 ? '+' : '') + A.news.score : '') + (A.cot ? ', COT ' + (A.cot.score > 0 ? '+' : '') + A.cot.score : '') + ')</dd>';
    if(s) h += '<dt>Entry</dt><dd>' + fmt(s.entry) + ' (market)</dd><dt>Stop</dt><dd>' + fmt(s.sl) + '</dd><dt>Target 1</dt><dd>' + fmt(s.tp1) + ' (' + prefs.tpR + 'R)</dd><dt>Target 2</dt><dd>' + fmt(s.tp2) + ' (3R)</dd>';
    h += '</dl>';
    if(A.st.pos) h += '<div class="ag-row"><button type="button" class="sell" data-act="close" style="background:var(--text);color:var(--bg)">Close position</button></div>';
    else if(s) h += '<div class="ag-row"><button type="button" class="' + (s.side === 'long' ? 'buy' : 'sell') + '" data-act="place">' + (s.side === 'long' ? 'Buy' : 'Sell') + ' (practice)</button><button type="button" data-act="real" style="background:var(--surface);color:var(--text);border-color:var(--line)">Real order in MT5</button></div>';
    if(A.missing.length) h += '<p class="hint" style="margin:6px 0;color:var(--amber,#FFB300)">Not included: ' + A.missing.map(esc).join(' · ') + '</p>';
    h += '<details><summary class="hint" style="cursor:pointer">What the agent sees</summary><dl class="ag-kv" style="margin-top:6px">' + A.parts.map(p => '<dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + ' (' + (p[2] > 0 ? '+' : '') + p[2] + ')</dd>').join('') +
      '<dt>Chart</dt><dd>' + (A.tech > 0 ? '+' : '') + A.tech + '</dd>' + (A.news ? '<dt>News</dt><dd>' + (A.news.score > 0 ? '+' : '') + A.news.score + ' (' + esc(A.news.bias) + ')</dd>' : '') + (A.cot ? '<dt>COT</dt><dd>' + (A.cot.score > 0 ? '+' : '') + A.cot.score + ' (' + esc(A.cot.verdict) + ', ' + esc(A.cot.cotDate || '') + ')</dd>' : '') +
      '<dt>Formula</dt><dd>' + esc(A.formula) + ' = ' + A.total + '</dd><dt>Range</dt><dd>' + Math.round(A.rPos) + '% of last 100 candles</dd></dl></details>';
    $('agCard').innerHTML = h;
    $('agGuides').innerHTML = A.guides.map(g => '<li>' + esc(g) + '</li>').join('');
  }
  function say(text, who){
    const d = document.createElement('div');
    d.className = 'm ' + (who || 'ai'); d.textContent = text;
    $('agLog').appendChild(d); $('agLog').scrollTop = $('agLog').scrollHeight;
    const all = $('agLog').children; while(all.length > 40) all[0].remove();
  }

  /* ================= actions (shared by buttons, commands and Claude tools) ================= */
  const Actions = {
    place(side, sl, tp){
      const st = API().state();
      if(st.pos) return 'There is already an open position. Close it first.';
      const a = analyze(), s = a.setup && a.setup.side === side ? a.setup : null;
      const given = v => v != null && v !== '';
      // Every order (buttons, commands, Claude, auto-trade) is checked here: real price, live feed, levels on the right side, sane distances.
      const v = Core.validateProposal({ side, sl:given(sl) ? sl : s ? s.sl : null, tp:given(tp) ? tp : s ? s.tp1 : null }, st);
      if(!v.ok) return 'Not placed: ' + v.errors.join(' ');
      const o = { sl:v.sl == null ? undefined : v.sl, tp:v.tp == null ? undefined : v.tp, by:'AI' };
      const ok = side === 'long' ? API().buy(o) : API().sell(o);
      if(!ok) return 'Couldn\'t open the trade (check the stop and target levels).';
      const p = API().state().pos;
      render();
      return (side === 'long' ? 'Bought' : 'Sold') + ' at ' + fmt(p.entry) + ' on the practice account. SL ' + fmt(p.sl) + ', TP ' + fmt(p.tp) + '.';
    },
    close(){ return API().close() ? 'Position closed.' : 'No open position.'; },
    setTf(tf){ return API().setTf(tf) ? 'Switched to ' + tf + '.' : 'That timeframe isn\'t available for this data. Options: ' + API().state().tfs.join(', ') + '.'; },
    async market(ticker){ const m = MARKETS.find(x => x[0] === ticker); try { await API().openMarket(ticker, m ? m[1] : ticker); return 'Loaded ' + (m ? m[1] : ticker) + '.'; } catch(e){ return 'Couldn\'t load ' + ticker + ': ' + e.message; } },
    tab(t){ post({ type:'openTab', tab:t }); return 'Opening ' + t + '.'; },
    real(side, sl, tp){
      const st = API().state(), sym = isGoldName(st.name) ? 'XAUUSD' : st.name;
      const a = analyze(), s = a.setup;
      sl = isFinite(sl) ? sl : s && s.side === side ? s.sl : null; tp = isFinite(tp) ? tp : s && s.side === side ? s.tp1 : null;
      const v = Core.validateProposal({ side, sl, tp }, st);
      if(!v.ok) return 'Order not prepared: ' + v.errors.join(' ');
      const txt = (side === 'long' ? 'BUY ' : 'SELL ') + sym + ' market' + (sl ? ' SL ' + fmt(sl) : '') + (tp ? ' TP ' + fmt(tp) : '');
      copy(txt); post({ type:'openMt5' });
      return 'Copied "' + txt + '" and opened MT5. Place it there with your lot size and confirm. Brokers don\'t let other apps send real orders.';
    },
    analysis(){
      const a = analyze();
      if(!a.ready) return a.why || 'Not enough candles yet.';
      const s = a.setup;
      return (a.side ? (a.side === 'long' ? 'LONG' : 'SHORT') + ' bias, confluence ' + a.conf + '/100 (score ' + a.total + '; not a win probability).' : 'No clear trade (score ' + a.total + ').') +
        (a.missing.length ? '\nNot included: ' + a.missing.join('; ') + '.' : '') +
        (s ? '\nSetup: entry ' + fmt(s.entry) + ', SL ' + fmt(s.sl) + ', TP1 ' + fmt(s.tp1) + ', TP2 ' + fmt(s.tp2) + '.' : '') +
        '\n• ' + a.guides.slice(0, 5).join('\n• ');
    },
    news(){
      const v = lsRaw('news.verdict', null), cards = lsRaw('news.cards.v1', []).slice(0, 6);
      if(!v && !cards.length) return 'No news loaded yet. Open the News tab once.';
      return (v ? 'Gold news verdict: ' + v.bias + ' (' + (v.score > 0 ? '+' : '') + v.score + ').\n' + v.strat + '\n' : '') +
        cards.map(c => (c.dir > 0 ? '▲ ' : c.dir < 0 ? '▼ ' : '◆ ') + c.title).join('\n');
    },
  };
  function copy(t){
    try { navigator.clipboard.writeText(t).catch(() => fallbackCopy(t)); } catch(e){ fallbackCopy(t); }
  }
  function fallbackCopy(t){ const x = document.createElement('textarea'); x.value = t; document.body.appendChild(x); x.select(); try { document.execCommand('copy'); } catch(e){} x.remove(); }

  /* ================= built-in command parser ================= */
  const num = (re, s) => { const m = re.exec(s); return m ? parseFloat(m[1]) : undefined; };
  async function local(q){
    const s = q.toLowerCase();
    const sl = num(/\b(?:sl|stop(?: loss)?)\s*(?:at|@|=)?\s*([\d.]+)/, s), tp = num(/\b(?:tp|target|take profit)\s*(?:at|@|=)?\s*([\d.]+)/, s);
    const real = /\b(real|live account|mt5|xm|octa)\b/.test(s);
    if(/\b(close|exit|flatten)\b/.test(s)) return Actions.close();
    if(/\b(buy|long)\b/.test(s) && !/\?/.test(s)) return real ? Actions.real('long', sl, tp) : Actions.place('long', sl, tp);
    if(/\b(sell|short)\b/.test(s) && !/\?/.test(s)) return real ? Actions.real('short', sl, tp) : Actions.place('short', sl, tp);
    const tf = /\b(1m|5m|15m|30m|1h|4h|1d|daily)\b/.exec(s);
    if(tf) return Actions.setTf(tf[1] === 'daily' ? '1D' : tf[1].replace('d', 'D'));
    for(const m of MARKETS) if(m[2].test(s) && /\b(open|show|load|switch|chart|go to)\b/.test(s)) return Actions.market(m[0]);
    if(/\bopen\b.*\b(news|scanner|markets|journal|alerts|brokers|me)\b/.test(s)) return Actions.tab(/\b(news|scanner|markets|journal|alerts|brokers|me)\b/.exec(s)[1]);
    if(/\breplay\b/.test(s)){ const on = !/\b(off|hide|stop)\b/.test(s); API().setReplay(on); return 'Replay mode ' + (on ? 'on.' : 'off.'); }
    if(/\b(landscape|full ?screen|rotate)\b/.test(s)){ $('rotateBtn').click(); return 'Toggled landscape.'; }
    if(/\bauto\b/.test(s)){ prefs.auto = !/\b(off|stop|disable)\b/.test(s); savePrefs(); $('agAuto').checked = prefs.auto; render(); return 'Auto-trade ' + (prefs.auto ? 'on (practice account, setups with confluence ≥ ' + prefs.minConf + '/100).' : 'off.'); }
    if(/\bnews|headline/.test(s)) return Actions.news();
    if(/sentiment|analy|trade|setup|why|bias|signal|now|guide|what/.test(s)) return Actions.analysis();
    return null;
  }

  /* ================= Claude (optional, user's own key) ================= */
  const TOOLS = [
    { name:'get_chart_analysis', description:'Current chart: market, timeframe, price, the built-in agent\'s analysis (bias, confluence score 50-95 which is NOT a win probability, setup, guides, missing inputs), open position and the last 40 closed candles.', input_schema:{ type:'object', properties:{}, additionalProperties:false } },
    { name:'get_gold_news', description:'Gold news verdict and latest scored headlines from the News tab, plus upcoming high-impact events.', input_schema:{ type:'object', properties:{}, additionalProperties:false } },
    { name:'place_practice_order', description:'Open a market order on the in-app practice account. Omit stop_loss / take_profit to use the agent\'s setup levels.', input_schema:{ type:'object', properties:{ side:{ type:'string', enum:['buy','sell'] }, stop_loss:{ type:'number' }, take_profit:{ type:'number' } }, required:['side'], additionalProperties:false } },
    { name:'close_position', description:'Close the open practice position at the current price.', input_schema:{ type:'object', properties:{}, additionalProperties:false } },
    { name:'set_timeframe', description:'Change the chart timeframe.', input_schema:{ type:'object', properties:{ timeframe:{ type:'string', enum:['1m','5m','15m','30m','1h','4h','1D'] } }, required:['timeframe'], additionalProperties:false } },
    { name:'open_market', description:'Load another market on the chart.', input_schema:{ type:'object', properties:{ ticker:{ type:'string', enum:MARKETS.map(m => m[0]) } }, required:['ticker'], additionalProperties:false } },
    { name:'open_app_tab', description:'Switch the app to another tab.', input_schema:{ type:'object', properties:{ tab:{ type:'string', enum:['markets','scanner','news','journal','alerts','brokers','me'] } }, required:['tab'], additionalProperties:false } },
    { name:'prepare_real_order', description:'For the user\'s real XM / Octa account: copy the order text to the clipboard and open MT5 so the user can place and confirm it there. The app cannot send real orders itself.', input_schema:{ type:'object', properties:{ side:{ type:'string', enum:['buy','sell'] }, stop_loss:{ type:'number' }, take_profit:{ type:'number' } }, required:['side'], additionalProperties:false } },
  ];
  const SYSTEM = 'You are the trading agent inside the COT Sentiment Android app (gold-first). You can read the chart, the gold news engine and COT positioning, and control the app with tools. ' +
    'Trades you place go to the in-app practice account; for real XM/Octa accounts you can only prepare an order for the user to confirm in MT5. ' +
    'Call get_chart_analysis before giving a trade view. Place or close orders only when the user asks you to. ' +
    'The confluence score is a heuristic of agreement between inputs, never describe it as a probability or chance of winning. If the chart is demo data or the price is stale, do not propose trades. ' +
    'Answer in a few short lines suited to a phone screen: bias, levels, why, and the main risk. Plain text, no markdown tables. You are not a financial adviser; say so only if the user asks for guarantees.';
  let convo = [];
  async function runTool(name, input){
    switch(name){
      case 'get_chart_analysis': {
        const a = analyze(), st = a.st;
        if(!a.ready) return JSON.stringify({ market:st.name, ready:false, reason:a.why, demo:!!st.demo });
        return JSON.stringify({ market:st.name, timeframe:st.tfLabel, price:st.price, live:st.live, feed:st.feed, demo:!!st.demo, bias:a.side, confluence_not_probability:a.conf, score:a.total, missing_inputs:a.missing, chart_score:a.tech, setup:a.setup, guides:a.guides, open_position:st.pos && { side:st.pos.side, entry:st.pos.entry, sl:st.pos.sl, tp:st.pos.tp },
          indicator_panel:st.panel.map(r => r.label + ': ' + r.text), candles:st.candles.slice(-40).map(b => [b.time, +b.open.toFixed(st.precision), +b.high.toFixed(st.precision), +b.low.toFixed(st.precision), +b.close.toFixed(st.precision)]) });
      }
      case 'get_gold_news': {
        const cal = (lsRaw('news.cal', { events:[] }).events || []).filter(e => e.t > Date.now() && e.t - Date.now() < 3 * 86400e3 && e.impact >= 55).slice(0, 8);
        return JSON.stringify({ verdict:lsRaw('news.verdict', null), headlines:lsRaw('news.cards.v1', []).slice(0, 12).map(c => ({ title:c.title, gold_dir:c.dir, impact:c.impact, type:c.label, age_min:Math.round((Date.now() - c.ts) / 60e3) })),
          upcoming:cal.map(e => ({ title:e.title, in_min:Math.round((e.t - Date.now()) / 60e3), impact:e.impact })), cot:lsRaw('news.cot', null) });
      }
      case 'place_practice_order': return Actions.place(input.side === 'buy' ? 'long' : 'short', input.stop_loss, input.take_profit);
      case 'close_position': return Actions.close();
      case 'set_timeframe': return Actions.setTf(input.timeframe);
      case 'open_market': return await Actions.market(input.ticker);
      case 'open_app_tab': return Actions.tab(input.tab);
      case 'prepare_real_order': return Actions.real(input.side === 'buy' ? 'long' : 'short', input.stop_loss, input.take_profit);
    }
    throw new Error('Unknown tool ' + name);
  }
  async function claude(q){
    if(convo.length > 30) convo = [];   // start fresh rather than editing history
    convo.push({ role:'user', content:q });
    const start = convo.length - 1;   // where this question began; restored on any failure
    try {
      for(let turn = 0; turn < 6; turn++){
        const body = { model:prefs.model, max_tokens:16000, system:SYSTEM, tools:TOOLS, messages:convo, output_config:{ effort:'low' } };
        let beta = '';
        if(prefs.model !== 'claude-haiku-5-5'){ body.fallbacks = 'default'; beta = 'server-side-fallback-2026-07-01'; }
        const res = await Core.claude(body, beta), r = { ok:res.ok, status:res.status }, j = res.json;
        if(!r.ok){
          const msg = (j.error && j.error.message) || ('HTTP ' + r.status);
          if(r.status === 401) throw new Error(/No Claude API key/.test(msg) ? msg : 'The API key was rejected. Check it in Agent settings.');
          if(r.status === 429) throw new Error(/App limit/.test(msg) ? msg : 'Rate limited by the API. Try again in a moment.');
          throw new Error(msg);
        }
        if(j.stop_reason === 'refusal'){ convo.length = start; return 'Claude declined that request.'; }
        if(!Array.isArray(j.content)) throw new Error('Unexpected response from Claude.');
        convo.push({ role:'assistant', content:j.content });   // keep every block (thinking included) unchanged
        const uses = j.content.filter(b => b.type === 'tool_use');
        const text = j.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if(j.stop_reason !== 'tool_use' || !uses.length) return text || '(no answer)';
        if(text) say(text, 'ai');
        const results = [];
        for(const u of uses){
          let out, err = false;
          try { out = await runTool(u.name, u.input || {}); } catch(e){ out = e.message; err = true; }
          if(u.name !== 'get_chart_analysis' && u.name !== 'get_gold_news') say('▸ ' + out, 'sys');
          results.push({ type:'tool_result', tool_use_id:u.id, content:String(out), is_error:err });
        }
        convo.push({ role:'user', content:results });
      }
    } catch(e){ convo.length = start; throw e; }
    return 'Stopped after several steps. Ask again to continue.';
  }

  async function ask(q){
    q = q.trim(); if(!q) return;
    say(q, 'me');
    $('agSend').disabled = true;
    try {
      // Direct commands run at once; anything else goes to Claude when a key is set.
      const direct = /^(buy|sell|long|short|close|exit)\b/i.test(q) || /^\s*(1m|5m|15m|30m|1h|4h|1d)\s*$/i.test(q);
      const hasKey = !!(window.AppBridge && window.AppBridge.hasApiKey && window.AppBridge.hasApiKey());
      let out = direct || !hasKey ? await local(q) : null;
      if(out == null && hasKey) out = await claude(q);
      if(out == null) out = 'I can: analyse ("trade now?"), "buy" / "sell" (add "sl 4170 tp 4210"), "close", "15m", "open silver", "news", "open scanner", "replay off", "auto on". Add a Claude API key in settings to ask anything.';
      say(out, 'ai');
    } catch(e){ say(e.message, 'sys'); }
    finally { $('agSend').disabled = false; render(); }
  }

  /* ================= auto-trade on new closed candles ================= */
  let lastAutoKey = '';
  function autoTrade(){
    if(!prefs.on || !prefs.auto || !A || !A.ready || !A.setup || A.st.pos) return;
    if(!(A.sig && A.sigAgo === 0 && (A.sig.side === 'buy') === (A.side === 'long'))) return;   // needs a fresh signal that agrees
    if(A.conf < prefs.minConf || A.soon) return;
    const key = A.st.name + '|' + A.st.tfLabel + '|' + A.st.time;
    if(key === lastAutoKey) return;
    lastAutoKey = key;
    const msg = Actions.place(A.side, A.setup.sl, A.setup.tp1);
    API().flash('AI agent: ' + msg);
    if(A.st.live && /^(Bought|Sold)/.test(msg)) post({ type:'agentTrade', title:'AI agent ' + (A.side === 'long' ? 'BUY ' : 'SELL ') + A.st.name, body:msg });
  }

  /* ================= wiring ================= */
  function setOn(on){
    prefs.on = !!on; savePrefs();
    $('aiBtn').setAttribute('aria-pressed', String(prefs.on));
    render();
  }
  $('aiBtn').addEventListener('click', () => setOn(!prefs.on));
  $('agentBar').addEventListener('click', () => { renderCard(); $('agentDlg').showModal(); });
  $('agForm').addEventListener('submit', e => { e.preventDefault(); const q = $('agInput').value; $('agInput').value = ''; ask(q); });
  $('agChips').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if(b) ask(b.dataset.cmd); });
  $('agCard').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if(!b || !A || !A.ready) return;
    if(b.dataset.act === 'place' && A.setup) say(Actions.place(A.setup.side, A.setup.sl, A.setup.tp1), 'ai');
    if(b.dataset.act === 'real' && A.setup) say(Actions.real(A.setup.side), 'ai');
    if(b.dataset.act === 'close') say(Actions.close(), 'ai');
    render(); renderCard();
  });
  Core.migrateApiKey(prefs, savePrefs);
  // The key field never shows the saved key: it can only be replaced or cleared.
  function keyStatus(){
    const B = window.AppBridge, has = !!(B && B.hasApiKey && B.hasApiKey());
    $('agKey').value = '';
    $('agKey').placeholder = !B || !B.setApiKey ? 'Available in the Android app' : has ? 'Saved (encrypted). Type a new key to replace, or "clear"' : 'sk-ant-…';
    $('agKey').disabled = !B || !B.setApiKey;
  }
  keyStatus();
  $('agAuto').checked = prefs.auto; $('agMinConf').value = prefs.minConf; $('agTpR').value = prefs.tpR; $('agModel').value = prefs.model;
  $('agAuto').addEventListener('change', function(){ prefs.auto = this.checked; savePrefs(); render(); });
  $('agMinConf').addEventListener('change', function(){ prefs.minConf = clamp(+this.value || 70, 50, 95); this.value = prefs.minConf; savePrefs(); });
  $('agTpR').addEventListener('change', function(){ prefs.tpR = clamp(+this.value || 1.5, 0.5, 10); this.value = prefs.tpR; savePrefs(); render(); });
  $('agKey').addEventListener('change', function(){
    const v = this.value.trim();
    if(window.AppBridge && window.AppBridge.setApiKey) window.AppBridge.setApiKey(/^clear$/i.test(v) ? '' : v);
    convo = []; keyStatus();
  });
  $('agModel').addEventListener('change', function(){ prefs.model = this.value; savePrefs(); convo = []; });

  window.addEventListener('chart:candle', () => { render(); autoTrade(); });
  setInterval(() => { if(prefs.on && !document.hidden) render(); }, 5000);   // live price, news and position updates
  setOn(prefs.on);
  say('Hi! I watch this chart, the gold news and COT. Ask "trade now?", or give a command like "buy", "15m" or "open silver".', 'sys');
  window.ChartAgent = { analyze, ask, Actions, prefs };
})();
