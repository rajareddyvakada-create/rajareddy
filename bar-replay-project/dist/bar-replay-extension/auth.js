// Google sign-in for Bar Replay (Chrome extension).
// Uses chrome.identity.launchWebAuthFlow, so it works in Chrome, Edge and Brave.
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const clientId = ((window.BR_CONFIG || {}).googleClientId || '').trim();
  const inExtension = typeof chrome !== 'undefined' && !!(chrome.storage && chrome.identity);
  const LOCAL_USER = { id:'local', name:'', email:'', picture:'', local:true };

  const store = {
    get: () => new Promise(r => { try { chrome.storage.local.get('br_user', v => r((v && v.br_user) || null)); } catch(e){ r(null); } }),
    set: u => new Promise(r => { try { chrome.storage.local.set({ br_user:u }, () => r()); } catch(e){ r(); } }),
    clear: () => new Promise(r => { try { chrome.storage.local.remove('br_user', () => r()); } catch(e){ r(); } })
  };

  function authFlow(url){
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url, interactive:true }, resp => {
        const err = chrome.runtime.lastError;
        if(err || !resp) reject(new Error('Sign-in was cancelled or blocked. Try again.'));
        else resolve(resp);
      });
    });
  }

  async function signIn(){
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: clientId,
      response_type: 'token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: 'openid email profile',
      prompt: 'select_account'
    });
    const resp = await authFlow(url);
    const p = new URLSearchParams(resp.split('#')[1] || resp.split('?')[1] || '');
    if(p.get('error')) throw new Error(p.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google refused the sign-in (' + p.get('error') + ').');
    const token = p.get('access_token');
    if(!token) throw new Error('Google did not return a sign-in token. Try again.');
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers:{ Authorization:'Bearer ' + token } });
    if(!r.ok) throw new Error('Couldn’t read your Google profile. Try again.');
    const info = await r.json();
    const user = { id:info.sub, email:info.email || '', name:info.name || info.email || 'Google user', picture:info.picture || '' };
    await store.set(user);
    return user;
  }

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  function done(user){ $('gate').hidden = true; resolveReady(user); }

  async function start(){
    if(!inExtension){ done(LOCAL_USER); return; }
    const existing = await store.get();
    if(existing && clientId){ done(existing); return; }
    $('gateMsg').textContent = 'Sign in to replay charts, see UT Bot signals and practise trades. Settings and trades are kept separately for each account.';
    if(clientId){ $('googleBtn').hidden = false; }
    else {
      $('setup').hidden = false;
      $('redirUri').textContent = chrome.identity.getRedirectURL();
      $('skipAuth').hidden = false;
    }
  }

  $('googleBtn').addEventListener('click', async () => {
    const b = $('googleBtn');
    b.disabled = true; b.textContent = 'Waiting for Google…'; $('gateErr').hidden = true;
    try { done(await signIn()); }
    catch(e){ $('gateErr').textContent = e.message; $('gateErr').hidden = false; }
    finally { b.disabled = false; b.textContent = 'Continue with Google'; }
  });
  $('skipAuth').addEventListener('click', () => done(LOCAL_USER));

  window.BRAuth = { ready, async signOut(){ await store.clear(); location.reload(); } };
  start();
})();
