(()=>{
 if(!location.href.startsWith("http://localhost")) return;
 const realFetch=window.fetch.bind(window);
 const base=Math.floor(Date.now()/60000)*60000;
 const px=t=>2650+Math.sin(t/3.6e6)*6+Math.sin(t/5e5)*1.5;
 function kl(start,limit){ const out=[]; let t=Math.ceil(Math.max(start,base-8*86400000)/60000)*60000;
   for(let i=0;i<limit && t<=base;i++,t+=60000){ const o=px(t), c=px(t+60000); out.push([t,o.toFixed(2)+'000000',(Math.max(o,c)+0.35).toFixed(2),(Math.min(o,c)-0.35).toFixed(2),c.toFixed(2)+'000000','1',t+59999,'0',1,'0','0','0']); } return out; }
 const fmt=t=>new Date(t).toISOString().slice(0,19).replace('T',' ');
 window.__calls=[];
 window.fetch=async(url,opts)=>{ url=String(url); window.__calls.push(url);
   if(url.includes('/api/v3/klines')){ const u=new URL(url); if(u.searchParams.get('symbol')==='BADSYM') return new Response(JSON.stringify({code:-1121,msg:'Invalid symbol.'}),{status:400}); return new Response(JSON.stringify(kl(+u.searchParams.get('startTime'),+u.searchParams.get('limit'))),{status:200}); }
   if(url.includes('api.twelvedata.com')){ const u=new URL(url); if(u.searchParams.get('apikey')==='bad') return new Response(JSON.stringify({code:401,message:'**apikey** parameter is incorrect or not specified.',status:'error'}),{status:200});
     const n=+u.searchParams.get('outputsize'); const end=u.searchParams.get('end_date'); let t=end?Date.parse(end.replace(' ','T')+'Z'):base; const vals=[];
     for(let i=0;i<n;i++,t-=60000){ const o=px(t),c=px(t+60000); vals.push({datetime:fmt(t),open:o.toFixed(5),high:(Math.max(o,c)+.3).toFixed(5),low:(Math.min(o,c)-.3).toFixed(5),close:c.toFixed(5)}); }
     return new Response(JSON.stringify({meta:{symbol:'XAU/USD'},values:vals,status:'ok'}),{status:200}); }
   if(url.includes('oauth2/v3/userinfo')) return new Response(JSON.stringify({sub:'1234',name:'Test Trader',email:'test.trader@gmail.com',picture:''}),{status:200});
   return realFetch(url,opts); };
 class FakeWS{ constructor(url){ this.url=url; window.__ws=this; this.n=0; setTimeout(()=>{ this.onopen&&this.onopen(); this.iv=setInterval(()=>this.tick(),120); },50); }
   tick(){ const m=base+Math.floor(this.n/4)*60000; const o=px(m), c=o+((this.n%4)-1.5)*2.2; this.n++;
     this.onmessage&&this.onmessage({data:JSON.stringify({e:'kline',k:{t:m,o:o.toFixed(2),h:(Math.max(o,c)+.2).toFixed(2),l:(Math.min(o,c)-.2).toFixed(2),c:c.toFixed(2),x:false}})}); }
   close(){ clearInterval(this.iv); } }
 window.WebSocket=FakeWS;
 try{ if(window.chrome && chrome.identity){ chrome.identity.launchWebAuthFlow=(o,cb)=>{ window.__authUrl=o.url; setTimeout(()=>cb(chrome.identity.getRedirectURL()+'#access_token=tok123&token_type=Bearer&expires_in=3599'),20); }; } }catch(e){ window.__mockErr=String(e); }
})();
(()=>{ if(!location.href.startsWith('http://localhost')) return;
 const b64u=o=>btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
 window.google={accounts:{id:{initialize(o){ window.__gisInit=o; }, renderButton(el,o){ window.__gisBtnOpts=o; const b=document.createElement('button'); b.id='fakeGis'; b.textContent='Continue with Google'; b.onclick=()=>window.__gisInit.callback({credential:b64u({alg:'RS256'})+'.'+b64u({aud:'web-client.apps.googleusercontent.com',sub:'777',email:'ravi.trader@gmail.com',name:'Ravi Kumar',picture:''})+'.sig'}); el.appendChild(b); }, disableAutoSelect(){ window.__dis=true; }}}};
})();
