const {test}=require('node:test');
const assert=require('node:assert/strict');
const {io}=require('socket.io-client');
const {createApp}=require('../server.cjs');
const event=(s,n)=>new Promise(r=>s.once(n,r));
const ack=(s,n,d)=>new Promise(r=>s.emit(n,d,r));
test('shared world, calibrated viewports, room isolation and cleanup',async t=>{
 const app=createApp();await new Promise(r=>app.http.listen(0,r));
 const url='http://localhost:'+app.http.address().port,clients=[];
 t.after(async()=>{clients.forEach(s=>s.disconnect());await app.close();});
 async function join(room){const s=io(url,{transports:['websocket']});clients.push(s);await event(s,'connect');const result=await ack(s,'join',{room,w:200,h:150});assert.ok(result.id);return s;}
 const a=await join('DEMO'),b=await join('DEMO'),other=await join('OTHER');
 let sa=await event(a,'state'),sb=await event(b,'state');assert.equal(sa.devices.length,2);assert.deepEqual(sa.bodies.map(b=>b.id),sb.bodies.map(b=>b.id));
 assert.equal((await event(other,'state')).devices.length,1);
 a.emit('layout',{id:b.id,x:250,y:100,w:100,h:150});sa=await event(a,'state');assert.equal(sa.devices.find(d=>d.id===b.id).x,250);
 await new Promise(r=>setTimeout(r,40));a.emit('launch',{x:190,y:110,vx:15,vy:0});
 let ball;for(let i=0;i<20;i++){sa=await event(a,'state');ball=sa.bodies.find(b=>b.ball);if(ball?.x>250)break;}assert.ok(ball.x>250,'ball crosses viewport gap in global space');
 assert.equal((await event(other,'state')).bodies.filter(b=>b.ball).length,0);
 a.emit('reset');sa=await event(a,'state');assert.equal(sa.bodies.length,24);
 b.disconnect();sa=await event(a,'state');assert.equal(sa.devices.length,1);
});
test('invalid room names are rejected',async t=>{const app=createApp();await new Promise(r=>app.http.listen(0,r));const s=io('http://localhost:'+app.http.address().port);t.after(async()=>{s.disconnect();await app.close();});await event(s,'connect');assert.ok((await ack(s,'join',{room:'!'})).error);});
