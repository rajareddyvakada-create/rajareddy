// The clock maths from index.html, run directly with the device in Asia/Kolkata (UTC+5:30).
const fs=require('fs');
const html=fs.readFileSync((process.env.XM_ROOT || require('path').join(__dirname,'..')) + '/frontend/index.html','utf8');
const grab=n=>{const i=html.indexOf('function '+n+'(');let d=0;for(let k=html.indexOf('{',i);k<html.length;k++){if(html[k]==='{')d++;else if(html[k]==='}'&&--d===0)return html.slice(i,k+1);}};
const state={timeMode:'local',serverOffset:10800};                 // broker on UTC+3
const fn=new Function('state',grab('zoneLabel')+grab('toChart')+';return {zoneLabel,toChart};')(state);
let fail=0;
const is=(name,got,want)=>{const okk=got===want;if(!okk)fail++;console.log((okk?'PASS ':'FAIL ')+name+' — '+got+(okk?'':' (expected '+want+')'));};

// 12:00 on the broker's clock during summer = 09:00 UTC = 14:30 in Kolkata
const broker = Date.UTC(2026,6,15,12,0,0)/1000;
is('Broker noon shows as 14:30 on this device', new Date(fn.toChart(broker)*1000).toISOString().slice(11,16), '14:30');
state.timeMode='server';
is('Server mode shows the broker clock unchanged', new Date(fn.toChart(broker)*1000).toISOString().slice(11,16), '12:00');
state.timeMode='local'; state.serverOffset=null;
is('Without a measured offset it leaves times alone', fn.toChart(broker), broker);
state.serverOffset=10800;
is('Zone label for the device', fn.zoneLabel(-new Date().getTimezoneOffset()*60), 'UTC+5:30');
is('Zone label for the broker', fn.zoneLabel(10800), 'UTC+3');
is('Zone label west of UTC', fn.zoneLabel(-18000), 'UTC-5');
process.exit(fail?1:0);
