// Stand-in for the MT5 bridge so the frontend can be tested without Windows/MT5.
// Mirrors the same endpoints, auth, JSON shapes and websocket protocol as backend/server.py.
const http=require('http'), fs=require('fs'), crypto=require('crypto');
const KEY='test-key-123', PORT=Number(process.env.PORT)||8711;
const FRONT=(process.env.XM_ROOT || require('path').join(__dirname,'..')) + '/frontend/index.html';
let price=4000.00, positions=[], ticket=500000;
const seen=new Set();
const state={orders:[],closes:[]};
const TOTAL=1200, SERVER_OFFSET=10800, MAXBARS=5000;   // broker clock UTC+3, like XM in summer
const TF={M1:60,M5:300,M15:900,H1:3600,H4:14400,D1:86400};

const auth=(req,url)=>{
  const h=req.headers['x-api-key'];
  const q=url.searchParams.get('key');
  return (h&&h===KEY)||(q&&q===KEY);
};
const send=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(obj));};

function candles(tfSec,count,offset){
  const now=Math.floor(Date.now()/1000), end=Math.floor(now/tfSec)*tfSec-offset*tfSec, out=[];
  for(let i=count-1;i>=0;i--){
    const t=end-i*tfSec, k=t/tfSec;
    const base=3980+Math.sin(k/9)*6+Math.sin(k/37)*14;
    const o=+(base).toFixed(2), c=+(base+Math.sin(k/3)*1.4).toFixed(2);
    out.push({time:t,open:o,high:+(Math.max(o,c)+0.9).toFixed(2),low:+(Math.min(o,c)-0.9).toFixed(2),close:c,volume:120});
  }
  price=out[out.length-1].close;
  return out;
}

function handleCandles(url,res){
  const tf=url.searchParams.get('timeframe')||'M5';
  if(!TF[tf]) return send(res,400,{detail:'Unknown timeframe'});
  const sym=url.searchParams.get('symbol')||'XAUUSD';
  if(!['GOLD','EURUSD','US30Cash','XAGUSD','GBPJPY'].includes(sym)) return send(res,404,{detail:"Unknown symbol '"+sym+"'."});
  const count=Math.min(Number(url.searchParams.get('count'))||300,5000);
  const offset=Number(url.searchParams.get('offset'))||0;
  const left=Math.max(0,TOTAL-offset), n=Math.min(count,left);
  return send(res,200,{symbol:sym,timeframe:tf,digits:2,count:n,offset,
    candles:n?candles(TF[tf],n,offset):[],
    has_more:offset+n<TOTAL, max_bars:MAXBARS, server_utc_offset:SERVER_OFFSET});
}

const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://x');
  if(url.pathname==='/'||url.pathname==='/index.html'){ res.writeHead(200,{'content-type':'text/html'}); return res.end(fs.readFileSync(FRONT)); }
  if(!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  if(url.pathname!=='/api/health' && !auth(req,url)) return send(res,401,{detail:'Missing or wrong X-API-Key.'});
  if(url.pathname==='/api/candles'){
    const want=url.searchParams.get('symbol')||'';
    if(!seen.has(want)){ seen.add(want); return setTimeout(()=>handleCandles(url,res),2600); }
    return handleCandles(url,res);
  }
  if(url.pathname==='/api/symbols'){
    const all=url.searchParams.get('all')==='true', q=(url.searchParams.get('search')||'').toUpperCase();
    const watch=[{name:'GOLD',description:'Gold vs US Dollar'},{name:'EURUSD',description:'Euro vs US Dollar'},{name:'US30Cash',description:'Dow Jones 30'}];
    const every=watch.concat([{name:'XAGUSD',description:'Silver vs US Dollar'},{name:'GBPJPY',description:'Pound vs Yen'}]);
    let list=(all?every:watch).map(x=>Object.assign({path:'',digits:2,visible:true,volume_min:0.01,volume_max:50,volume_step:0.01},x));
    if(q) list=list.filter(x=>x.name.toUpperCase().includes(q)||x.description.toUpperCase().includes(q));
    return send(res,200,{count:list.length,symbols:list});
  }
  if(url.pathname==='/api/update'){
    if(req.method==='POST'){ state.updated=true; return send(res,200,{ok:true,changed:true,from:'aaa',current:'bbb',bytes:90000}); }
    return send(res,200,{enabled:true,current:'aaa',latest:global.__newer?'bbb':'aaa',newer:!!global.__newer,bytes:90000});
  }
  if(url.pathname==='/api/update-arm'){ global.__newer=true; return send(res,200,{ok:true}); }
  if(url.pathname==='/api/account') return send(res,200,{login:12345678,name:'Demo',server:'XMGlobal-MT5',currency:'USD',balance:10000,equity:10012.5,margin:120,margin_free:9892.5,margin_level:8343,profit:positions.reduce((s,p)=>s+p.profit,0),leverage:100,trade_allowed:true});
  if(url.pathname==='/api/positions') return send(res,200,{count:positions.length,positions});
  if(url.pathname==='/api/order'&&req.method==='POST'){
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      const o=JSON.parse(body||'{}'); state.orders.push(o);
      if(!(o.lot>0)) return send(res,422,{detail:'lot must be above zero'});
      if(o.lot>1) return send(res,200,{ok:false,retcode:10014,retcode_text:'Invalid lot size',comment:'Invalid volume'});
      const t=++ticket;
      positions.push({ticket:t,symbol:o.symbol,direction:o.direction,volume:o.lot,price_open:price,price_current:price,sl:o.sl||0,tp:o.tp||0,profit:0.42,swap:0,time:Math.floor(Date.now()/1000),magic:770077,comment:'xm-bridge'});
      return send(res,200,{ok:true,retcode:10009,retcode_text:'Done',deal:t+900,order:t,volume:o.lot,price:price,comment:'Request executed'});
    });
    return;
  }
  if(url.pathname==='/api/close'&&req.method==='POST'){
    let body=''; req.on('data',d=>body+=d); req.on('end',()=>{
      const o=JSON.parse(body||'{}'); state.closes.push(o);
      const i=positions.findIndex(p=>p.ticket===o.ticket);
      if(i<0) return send(res,404,{detail:'No open position with ticket '+o.ticket});
      positions.splice(i,1);
      return send(res,200,{ok:true,retcode:10009,retcode_text:'Done',price:price,order:o.ticket});
    });
    return;
  }
  send(res,404,{detail:'not found'});
});

// minimal websocket server (RFC6455 text frames, no deps)
server.on('upgrade',(req,sock)=>{
  const url=new URL(req.url,'http://x');
  if(url.pathname!=='/ws/ticks') return sock.destroy();
  if(!auth(req,url)){ sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return sock.destroy(); }
  const key=req.headers['sec-websocket-key'];
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const frame=s=>{const b=Buffer.from(s);const h=b.length<126?Buffer.from([0x81,b.length]):Buffer.concat([Buffer.from([0x81,126]),Buffer.from([b.length>>8,b.length&255])]);return Buffer.concat([h,b]);};
  const sym=url.searchParams.get('symbol')||'XAUUSD';
  let n=0;
  const timer=setInterval(()=>{
    n++; price=+(price+(Math.random()-0.45)*0.6).toFixed(2);
    const bid=price, ask=+(price+0.30).toFixed(2);
    positions.forEach(p=>{p.price_current=bid;p.profit=+(((p.direction==='buy'?bid-p.price_open:p.price_open-bid))*p.volume*100).toFixed(2);});
    try{ sock.write(frame(JSON.stringify({symbol:sym,bid,ask,last:bid,time:Math.floor(Date.now()/1000)+SERVER_OFFSET,digits:2,server_utc_offset:SERVER_OFFSET,changed:true}))); }catch(e){ clearInterval(timer); }
  },200);
  sock.on('close',()=>clearInterval(timer));
  sock.on('error',()=>clearInterval(timer));
});
server.listen(PORT,()=>console.log('mock bridge on http://localhost:'+PORT));
process.on('SIGTERM',()=>{console.log(JSON.stringify(state));server.close();process.exit(0);});
