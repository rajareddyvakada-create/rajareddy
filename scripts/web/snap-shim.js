// Web snapshot: answers the app's data requests from recordings made when the snapshot was built.
// The artifact viewer blocks requests to other sites, so this is how the web build shows real data.
(function(){
  var S = null;
  try { if(window.parent !== window && window.parent.__SNAP) S = window.parent.__SNAP; } catch(e){}
  S = S || window.__SNAP;
  if(!S) return;
  window.__SNAP = S;
  function key(u){
    try {
      var x = new URL(u, location.href), k = (/finance\.yahoo\.com$/.test(x.host) ? 'yahoo' : x.host) + x.pathname + x.search;
      return k.replace(/when%3A\w+/gi, '').replace(/[?&]_=\d+/, '');
    } catch(e){ return String(u); }
  }
  var realFetch = window.fetch;
  window.fetch = function(input, init){
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if(!/^https?:/i.test(u)) return realFetch.apply(this, arguments);
    var body = S.map[key(u)];
    if(body == null) return Promise.reject(new TypeError('Not part of this web snapshot. Live data is in the Android app.'));
    return Promise.resolve(new Response(body, { status:200, headers:{ 'content-type':'application/json' } }));
  };
  // No TradingView embed (the viewer blocks other sites) and no "Live" wording on recorded data.
  function tidy(){
    var st = document.createElement('style');
    st.textContent = '#tvBtn,#tvOpen,.tv-btn{display:none!important}';
    document.head.appendChild(st);
    var fix = function(){ document.querySelectorAll('#statusPill,#liveBadge,.src-live').forEach(function(el){ if(/^Live/.test(el.textContent)) el.textContent = 'Snapshot'; }); };
    new MutationObserver(fix).observe(document.body, { subtree:true, childList:true, characterData:true });
    fix();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tidy); else tidy();
  // Live streams need the app; fail like an offline connection.
  window.WebSocket = function(){ throw new Error('Live streams are only in the Android app'); };
})();
