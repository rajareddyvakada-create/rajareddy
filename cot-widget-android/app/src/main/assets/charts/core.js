// Calculations shared by the app's pages: COT parsing and scoring, candle checks, data freshness,
// trade levels, position size and AI order checks. No DOM access, so tests run it in Node (tests/core.test.js).
(function(root){
  'use strict';
  const Core = {};
  const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const DAY = 86400000;

  /* ---------- COT (CFTC Commitments of Traders) ----------
     Both datasets are futures-only. Each market is scored from two trader groups, named exactly as the CFTC names them:
       commodities (Disaggregated report): A = Managed money, B = Swap dealers
       financials (Traders in Financial Futures): A = Asset managers, B = Leveraged funds */
  Core.COT_DATASETS = {
    commodity: { report:'Disaggregated · futures only', url:'https://publicreporting.cftc.gov/resource/72hh-3qpy.json',
      a:{ name:'Managed money', long:'m_money_positions_long_all', short:'m_money_positions_short_all' },
      b:{ name:'Swap dealers', long:'swap_positions_long_all', short:'swap__positions_short_all' } },
    financial: { report:'Traders in Financial Futures · futures only', url:'https://publicreporting.cftc.gov/resource/gpe5-46if.json',
      a:{ name:'Asset managers', long:'asset_mgr_positions_long', short:'asset_mgr_positions_short' },
      b:{ name:'Leveraged funds', long:'lev_money_positions_long', short:'lev_money_positions_short' } }
  };
  Core.COT_MIN_WEEKS = 5;

  /** CFTC rows → [[date, netA, netB, openInterest]] oldest first. Rows with a missing or non-numeric field are
   *  dropped (never read as zero), and a repeated report date keeps its first row. */
  Core.parseCot = function(data, type){
    const ds = Core.COT_DATASETS[type];
    if(!ds) throw new Error('Unknown COT report type: ' + type);
    if(!Array.isArray(data)) throw new Error((data && data.message) || 'Unexpected CFTC response');
    const byDate = new Map();
    let dropped = 0;
    for(const row of data){
      const date = String((row && row.report_date_as_yyyy_mm_dd) || '').slice(0, 10);
      const v = row ? [row[ds.a.long], row[ds.a.short], row[ds.b.long], row[ds.b.short], row.open_interest_all].map(num) : [];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || v.length !== 5 || v.some(x => !isFinite(x) || x < 0) || byDate.has(date)){ dropped++; continue; }
      byDate.set(date, [date, v[0] - v[1], v[2] - v[3], v[4]]);
    }
    const rows = [...byDate.values()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
    return { rows, dropped };
  };

  /** Where the last close sits in the high-low range of the last 20 weekly bars ([high, low, close], oldest first). */
  Core.premiumDiscount = function(rows){
    const ok = (rows || []).filter(r => r && r.length >= 3 && r.every(isFinite) && r[0] >= r[1]);
    if(!ok.length) throw new Error('No valid weekly prices');
    const w = ok.slice(-20);
    const high = Math.max(...w.map(r => r[0])), low = Math.min(...w.map(r => r[1]));
    const price = ok[ok.length - 1][2], rng = high - low;
    const pos = rng === 0 ? 50 : Math.max(0, Math.min(100, (price - low) / rng * 100));
    return { price, pos:Math.round(pos), zone:pos > 50 ? 'PREMIUM' : 'DISCOUNT', hi:high, lo:low, closes:w.map(r => r[2]), weeks:w.length };
  };

  /** The sentiment score (−100…+100). Same point values as before; differences are marked CHANGED.
   *  1. Range zone: discount +35 (A's 4-week change ≥ 0) or +20; premium −35 (change ≤ 0) or −20.
   *  2. A's 4-week net change: up +30 in discount / +12 in premium; down −30 in premium / −12 in discount;
   *     CHANGED: unchanged now scores 0 (it used to count as a cut).
   *  3. B's weekly net change: ±20 with the change; if B's net position is beyond 1.2× its average size over the
   *     loaded weeks it counts against the move instead (∓10).
   *  4. Open interest up with A buying +15, up with A selling −15, otherwise 0.
   *  Verdict: ≥40 Bullish, ≥15 Lean bullish, >−15 Neutral, >−40 Lean bearish, else Bearish. */
  Core.scoreCot = function(cotRows, pd, type){
    const ds = Core.COT_DATASETS[type] || Core.COT_DATASETS.commodity, A = ds.a.name, B = ds.b.name;
    if(!cotRows || cotRows.length < Core.COT_MIN_WEEKS) throw new Error('Not enough COT history (' + (cotRows ? cotRows.length : 0) + ' weeks)');
    const cot = cotRows.map(r => ({ date:r[0], inst:r[1], lev:r[2], oi:r[3] }));
    const n = cot.length, cur = cot[n - 1], prev = cot[n - 2], four = cot[n - 5];
    const dInst = cur.inst - prev.inst, dLev = cur.lev - prev.lev, dOi = cur.oi - prev.oi, tInst = cur.inst - four.inst;
    const f = v => Math.abs(v).toLocaleString('en-US');
    let score = 0;
    const notes = [], parts = [];
    const add = (pts, tone, text, label) => { score += pts; notes.push([tone, text]); parts.push({ label, pts }); };

    if(pd.zone === 'DISCOUNT') add(tInst >= 0 ? 35 : 20, 'pos', 'Price in discount: lower half of its ' + pd.weeks + '-week range', 'Range zone');
    else add(tInst <= 0 ? -35 : -20, 'neg', 'Price in premium: upper half of its ' + pd.weeks + '-week range', 'Range zone');

    if(tInst > 0) add(pd.zone === 'DISCOUNT' ? 30 : 12, 'pos', A + ' added ' + f(tInst) + ' net longs over 4 weeks', A + ' (4 weeks)');
    else if(tInst < 0) add(pd.zone === 'PREMIUM' ? -30 : -12, 'neg', A + ' cut ' + f(tInst) + ' net longs over 4 weeks', A + ' (4 weeks)');
    else add(0, '', A + ' net position unchanged over 4 weeks', A + ' (4 weeks)');

    const levMean = cot.reduce((s, r) => s + Math.abs(r.lev), 0) / n;
    const levExtreme = Math.abs(cur.lev) > 1.2 * levMean;
    if(dLev > 0 && !levExtreme) add(20, 'pos', B + ' added ' + f(dLev) + ' net longs this week', B + ' (week)');
    else if(dLev < 0 && !levExtreme) add(-20, 'neg', B + ' cut ' + f(dLev) + ' net longs this week', B + ' (week)');
    else if(dLev > 0) add(-10, 'warn', B + ' net long is unusually large (above 1.2× its ' + n + '-week average): counted against the move', B + ' (week)');
    else if(dLev < 0) add(10, 'warn', B + ' net short is unusually large (above 1.2× its ' + n + '-week average): counted against the move', B + ' (week)');
    else add(0, '', B + ' unchanged this week', B + ' (week)');

    if(dOi > 0 && tInst > 0) add(15, 'pos', 'Open interest rising while ' + A.toLowerCase() + ' buy', 'Open interest');
    else if(dOi > 0 && tInst < 0) add(-15, 'neg', 'Open interest rising while ' + A.toLowerCase() + ' sell', 'Open interest');
    else if(dOi > 0) add(0, '', 'Open interest rising, ' + A.toLowerCase() + ' flat: no signal', 'Open interest');   // CHANGED wording (was "flat or falling")
    else add(0, '', 'Open interest flat or falling: positions unwinding', 'Open interest');

    score = Math.max(-100, Math.min(100, score));
    return { inst:cur.inst, dInst, lev:cur.lev, dLev, oi:cur.oi, dOi, tInst, score, verdict:Core.verdictFor(score), notes, parts,
      cotDate:cur.date, aName:A, bName:B, report:ds.report };
  };
  Core.verdictFor = s => (s >= 40 ? 'Bullish' : s >= 15 ? 'Lean bullish' : s > -15 ? 'Neutral' : s > -40 ? 'Lean bearish' : 'Bearish');

  /** COT data is as of a Tuesday and published the following Friday, so it is normally 3–10 days old.
   *  Older than 13 days means at least one weekly report is missing. */
  Core.cotFreshness = function(cotDate, now){
    const t = Date.parse(String(cotDate) + 'T00:00:00Z');
    if(!isFinite(t)) return { ageDays:null, stale:true };
    const ageDays = Math.floor(((now == null ? Date.now() : now) - t) / DAY);
    return { ageDays, stale:ageDays > 13 };
  };

  /* ---------- price data ---------- */

  /** Sorts by time, drops duplicates (the later bar wins) and bars that can't be real: a non-finite or non-positive
   *  price, or a high/low that doesn't contain the open and close. */
  Core.cleanCandles = function(list){
    const byTime = new Map();
    let dropped = 0;
    for(const b of list || []){
      const ok = b && isFinite(b.time) && [b.open, b.high, b.low, b.close].every(v => isFinite(v) && v > 0)
        && b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close);
      if(!ok){ dropped++; continue; }
      if(byTime.has(b.time)) dropped++;
      byTime.set(b.time, b);
    }
    return { bars:[...byTime.values()].sort((x, y) => x.time - y.time), dropped };
  };

  /** Live feed status. 'stale' = the stream is connected but no new price for max(2 minutes, 3 candles):
   *  market closed or the feed stalled. New signals and agent setups need 'live'. */
  Core.feedStatus = function(o){
    if(!o.online) return 'history';
    if(o.state === 'connecting') return 'connecting';
    if(o.state !== 'on') return 'off';
    const limit = Math.max(120000, 3 * (o.tfSec || 60) * 1000);
    return (o.now == null ? Date.now() : o.now) - (o.lastTickMs || 0) > limit ? 'stale' : 'live';
  };

  /* ---------- trades ---------- */

  /** Checks a trade's levels: long = stop below entry, target above; short = the reverse. sl/tp may be omitted. */
  Core.checkLevels = function(side, entry, sl, tp){
    const errors = [], dir = side === 'long' ? 1 : side === 'short' ? -1 : 0;
    if(!dir) errors.push('Side must be long or short.');
    if(!(isFinite(entry) && entry > 0)) errors.push('Entry price is missing or invalid.');
    if(sl != null && dir && isFinite(entry)){
      if(!isFinite(sl)) errors.push('Stop-loss is not a number.');
      else if((entry - sl) * dir <= 0) errors.push(dir > 0 ? 'For a buy the stop-loss must be below the entry.' : 'For a sell the stop-loss must be above the entry.');
    }
    if(tp != null && dir && isFinite(entry)){
      if(!isFinite(tp)) errors.push('Target is not a number.');
      else if((tp - entry) * dir <= 0) errors.push(dir > 0 ? 'For a buy the target must be above the entry.' : 'For a sell the target must be below the entry.');
    }
    return { ok:!errors.length, errors };
  };

  /** Risk and reward per unit and R:R, after a round-trip cost (spread + commission, in price units). */
  Core.riskReward = function(side, entry, sl, tp, cost){
    const dir = side === 'long' ? 1 : -1, c = cost || 0;
    const risk = (entry - sl) * dir + c, reward = (tp - entry) * dir - c;
    return { risk, reward, rr:risk > 0 ? reward / risk : null };
  };

  /** Units of the underlying in one lot or contract. Spot gold/silver use the usual CFD lot (XM: 100 oz, 5,000 oz);
   *  futures use the exchange contract size (CME/NYMEX/COMEX specs); crypto pairs are quoted per coin. */
  Core.CONTRACTS = {
    'XAU/USD':{ size:100, unit:'oz', kind:'CFD lot' }, 'XAG/USD':{ size:5000, unit:'oz', kind:'CFD lot' },
    'GC=F':{ size:100, unit:'oz', kind:'COMEX contract' }, 'SI=F':{ size:5000, unit:'oz', kind:'COMEX contract' },
    'CL=F':{ size:1000, unit:'barrels', kind:'NYMEX contract' }, 'NG=F':{ size:10000, unit:'MMBtu', kind:'NYMEX contract' },
    'HG=F':{ size:25000, unit:'lb', kind:'COMEX contract' }, 'ES=F':{ size:50, unit:'× index', kind:'CME contract' },
    'NQ=F':{ size:20, unit:'× index', kind:'CME contract' }, 'BTC-USD':{ size:1, unit:'BTC', kind:'coin' },
    'PAXGUSDT':{ size:1, unit:'PAXG', kind:'token' }, 'BTCUSDT':{ size:1, unit:'BTC', kind:'coin' }
  };
  /** Lots for a dollar risk, or null with the reason when it can't be worked out reliably. */
  Core.positionSize = function(riskUsd, entry, sl, symbol){
    const spec = Core.CONTRACTS[symbol];
    if(!spec) return { lots:null, reason:'Contract size for ' + (symbol || 'this market') + ' is unknown, so lot size isn\'t calculated.' };
    const dist = Math.abs(entry - sl);
    if(!(dist > 0)) return { lots:null, reason:'Stop distance is zero.' };
    if(!(riskUsd > 0)) return { lots:null, reason:'Risk per trade must be above zero.' };
    return { lots:riskUsd / (dist * spec.size), spec };
  };

  /** Does this candle close the position? Gaps past a level fill at the open. If the candle reaches both the stop
   *  and the target, the order inside the candle is unknown, so the stop is assumed first (conservative). */
  Core.barExit = function(pos, b){
    const long = pos.side === 'long';
    const hitSl = long ? b.low <= pos.sl : b.high >= pos.sl;
    const hitTp = pos.tp != null && (long ? b.high >= pos.tp : b.low <= pos.tp);
    if(hitSl){
      const gap = long ? b.open < pos.sl : b.open > pos.sl;
      return { price:gap ? b.open : pos.sl, reason:hitTp ? 'Stop-loss (stop and target in one candle: stop assumed first)' : 'Stop-loss' };
    }
    if(hitTp){
      const gap = long ? b.open > pos.tp : b.open < pos.tp;
      return { price:gap ? b.open : pos.tp, reason:'Target' };
    }
    return null;
  };

  /** R multiple after costs: (exit − entry) × direction − cost, divided by the planned stop distance. */
  Core.rMultiple = (side, entry, exit, slDist, cost) => ((exit - entry) * (side === 'long' ? 1 : -1) - (cost || 0)) / slDist;

  /** Validates an order the AI agent (or Claude) wants to place before it reaches the chart. */
  Core.validateProposal = function(p, st){
    const errors = [];
    if(st.demo) errors.push('The chart is showing demo (random) prices; load a real market first.');
    if(st.feed === 'stale' || st.feed === 'off') errors.push('The live price is ' + (st.feed === 'off' ? 'unavailable' : 'stale') + ', so no new trades.');
    if(!(isFinite(st.price) && st.price > 0)) errors.push('No current price.');
    const sl = p.sl == null || p.sl === '' ? null : Number(p.sl), tp = p.tp == null || p.tp === '' ? null : Number(p.tp);
    if(!errors.length){
      const lv = Core.checkLevels(p.side, st.price, sl, tp);
      errors.push(...lv.errors);
      if(lv.ok && sl != null && Math.abs(sl - st.price) > st.price * 0.05) errors.push('The stop-loss is more than 5% from the price; check the number.');
      if(lv.ok && tp != null && Math.abs(tp - st.price) > st.price * 0.2) errors.push('The target is more than 20% from the price; check the number.');
    }
    return { ok:!errors.length, errors, sl, tp };
  };

  /** Confluence score shown by the agent: how strongly the inputs agree (50 = none, 95 = max).
   *  It is a heuristic, not a probability of winning. */
  Core.confluence = total => Math.max(50, Math.min(95, Math.round(50 + Math.abs(total) * 0.5)));

  /** Claude request through the Android app, which adds the API key from encrypted storage, so the key never
   *  appears in page scripts or browser storage. Resolves to { status, ok, json }; network and app errors reject. */
  Core.claude = async function(body, beta){
    const B = root.AppBridge;
    if(!B || !B.claudeStart) throw new Error('Claude works in the Android app, where your API key is stored encrypted.');
    if(!B.hasApiKey()) throw new Error('No Claude API key saved. Add it in Charts → AI agent → Agent settings.');
    const id = B.claudeStart(JSON.stringify(body), beta || '');
    const t0 = Date.now();
    for(;;){
      await new Promise(r => setTimeout(r, 300));
      const res = B.claudeResult(id);
      if(res){
        const o = JSON.parse(res);
        if(o.status === 0) throw new Error(JSON.parse(o.body).error.message);
        let json = null;
        try { json = JSON.parse(o.body); } catch(e){}
        if(!json || typeof json !== 'object') throw new Error('Claude returned an unreadable response (HTTP ' + o.status + ').');
        return { status:o.status, ok:o.status >= 200 && o.status < 300, json };
      }
      if(Date.now() - t0 > 190000) throw new Error('Claude didn\'t answer in time.');
    }
  };
  /** Text blocks of a Messages response; throws when the shape is not what the API documents. */
  Core.claudeText = function(json){
    if(!json || !Array.isArray(json.content)) throw new Error('Unexpected response from Claude.');
    return json.content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
  };
  /** Moves a key saved by older versions (in browser storage) into encrypted storage and deletes the old copy. */
  Core.migrateApiKey = function(prefs, savePrefs){
    const B = root.AppBridge;
    if(prefs && prefs.key){
      if(B && B.setApiKey) B.setApiKey(prefs.key);
      prefs.key = '';   // removed from browser storage either way
      savePrefs();
    }
  };

  if(typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
