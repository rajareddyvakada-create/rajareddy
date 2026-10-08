// Google sign-in for the Bar Replay website (Google Identity Services).
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const clientId = ((window.BR_CONFIG || {}).googleClientId || '').trim();
  const LOCAL_USER = { id:'local', name:'', email:'', picture:'', local:true };
  const KEY = 'br_user';
  const getUser = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch(e){ return null; } };
  const setUser = u => { try { localStorage.setItem(KEY, JSON.stringify(u)); } catch(e){} };

  function decodeJwt(t){
    let p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    p += '='.repeat((4 - p.length % 4) % 4);
    const bin = atob(p);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function loadGis(){
    return new Promise((resolve, reject) => {
      if(window.google && google.accounts && google.accounts.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Couldn’t load Google sign-in. Check your internet connection and reload.'));
      document.head.appendChild(s);
    });
  }

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  function done(user){ $('gate').hidden = true; resolveReady(user); }
  function showErr(m){ $('gateErr').textContent = m; $('gateErr').hidden = false; }

  function onCredential(resp){
    try {
      const c = decodeJwt(resp.credential);
      if(c.aud !== clientId) throw new Error('aud');
      const user = { id:c.sub, email:c.email || '', name:c.name || c.email || 'Google user', picture:c.picture || '' };
      setUser(user);
      done(user);
    } catch(e){ showErr('Google sign-in didn’t work. Try again.'); }
  }

  async function start(){
    const existing = getUser();
    if(existing && clientId){ done(existing); return; }
    $('gateMsg').textContent = 'Sign in to replay charts, see UT Bot signals and practise trades. Settings and trades are kept separately for each account.';
    if(!clientId){
      $('setup').hidden = false;
      $('originUri').textContent = location.origin;
      $('skipAuth').hidden = false;
      return;
    }
    try {
      await loadGis();
      google.accounts.id.initialize({ client_id:clientId, callback:onCredential, auto_select:false, cancel_on_tap_outside:true });
      const w = Math.max(200, Math.min(400, $('gate').querySelector('.gate-card').clientWidth));
      $('googleBtn').hidden = false;
      google.accounts.id.renderButton($('googleBtn'), { theme:'filled_black', size:'large', shape:'pill', text:'continue_with', width:w });
    } catch(e){ showErr(e.message); }
  }

  $('skipAuth').addEventListener('click', () => done(LOCAL_USER));
  window.BRAuth = {
    ready,
    signOut(){
      try { localStorage.removeItem(KEY); if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch(e){}
      location.reload();
    }
  };
  start();
})();
