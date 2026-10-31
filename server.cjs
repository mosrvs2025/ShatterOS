const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { Engine, Bodies, Body, Composite, Sleeping } = require('matter-js');
const path = require('node:path');
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const number = (n,a,b,f=0) => typeof n === 'number' && Number.isFinite(n) ? clamp(n,a,b) : f;
function createApp() {
 const app=express(), http=createServer(app), io=new Server(http,{maxHttpBufferSize:16384});
 const mesh = import('./octopus-mesh/server.mjs').then(({createMeshServer}) => createMeshServer());
 app.use('/octopus', (req,res,next)=>{ if(req.path==='/' && !req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(308,req.originalUrl.split('?')[0]+'/' ); mesh.then(m=>m.handler(req,res)).catch(next); });
 app.use(express.static(path.join(__dirname,'public')));
 const rooms=new Map();
 function reset(r) {
  Composite.clear(r.engine.world,false); r.engine.gravity.y=0.8;
  const walls=[Bodies.rectangle(800,910,1800,20,{isStatic:true}),Bodies.rectangle(-10,450,20,900,{isStatic:true}),Bodies.rectangle(1610,450,20,900,{isStatic:true})];
  Composite.add(r.engine.world,walls);
  for(let i=0;i<24;i++) {const b=Bodies.rectangle(80+(i%6)*54,180+Math.floor(i/6)*54,38,38,{restitution:0.55,friction:0.1}); Sleeping.set(b,true); b.label='card'; b.plugin={color:['#a4f880','#c2a5ff','#ffbb71','#78dcf5'][i%4],home:{x:b.position.x,y:b.position.y}}; Composite.add(r.engine.world,b);}
 }
 io.on('connection',socket=>{
  let room,device,last=0;
  const limited=()=>{const now=Date.now();if(now-last<25)return true;last=now;return false;};
  socket.on('join',(data={},ack=()=>{})=>{
   if(room)return;
   const code=typeof data.room==='string'?data.room.toUpperCase():'';
   if(!/^[A-Z0-9-]{3,24}$/.test(code)) return ack({error:'Use a room code of 3–24 letters, numbers or hyphens.'});
   if(!rooms.has(code)){if(rooms.size>=100)return ack({error:'Server full'});const r={engine:Engine.create({enableSleeping:true}),devices:new Map(),tick:0};reset(r);rooms.set(code,r);}
   const r=rooms.get(code);if(r.devices.size>=12)return ack({error:'Room full'});
   room=code;device={id:socket.id,name:String(data.name||'Screen').slice(0,24),x:r.devices.size*200,y:100,w:number(data.w,30,1200,200),h:number(data.h,30,1200,140)};
   r.devices.set(socket.id,device);socket.join(room);ack({id:socket.id,room,device});
  });
  socket.on('layout',(d={})=>{if(!room||limited())return;const r=rooms.get(room),target=r.devices.get(d.id||socket.id);if(!target)return;for(const k of ['x','y','w','h'])if(k in d)target[k]=number(d[k],k==='w'||k==='h'?30:0,k==='w'||k==='h'?1200:1500,target[k]);});
  socket.on('launch',(d={})=>{if(!room||limited())return;const r=rooms.get(room);if(r.engine.world.bodies.length>100)return;const b=Bodies.circle(number(d.x,0,1600,device.x+20),number(d.y,0,850,device.y+20),12,{density:0.08,restitution:0.8});b.label='ball';b.plugin={color:'#eaff7b'};Body.setVelocity(b,{x:number(d.vx,-25,25,12),y:number(d.vy,-25,25,0)});Composite.add(r.engine.world,b);});
  socket.on('tilt',(d={})=>{if(!room||limited())return;const r=rooms.get(room);for(const b of r.engine.world.bodies){if(b.isStatic)continue;const p=b.position;if(p.x>=device.x&&p.x<=device.x+device.w&&p.y>=device.y&&p.y<=device.y+device.h)Body.applyForce(b,p,{x:number(d.x,-1,1)*b.mass*0.0015,y:number(d.y,-1,1)*b.mass*0.0015});}});
  socket.on('reset',()=>{if(room&&!limited())reset(rooms.get(room));});
  socket.on('disconnect',()=>{if(!room)return;const r=rooms.get(room);r.devices.delete(socket.id);if(!r.devices.size){Engine.clear(r.engine);rooms.delete(room);}});
 });
 const timer=setInterval(()=>{for(const [code,r]of rooms){Engine.update(r.engine,1000/60);r.tick++;if(r.tick%2===0)io.to(code).emit('state',{time:Date.now(),devices:[...r.devices.values()],bodies:r.engine.world.bodies.filter(b=>!b.isStatic).map(b=>({id:b.id,x:b.position.x,y:b.position.y,a:b.angle,ball:b.label==='ball',color:b.plugin.color}))});}},1000/60);
 return {http,io,rooms,close:async()=>{clearInterval(timer);await new Promise(resolve=>io.close(resolve));}};
}
if(require.main===module){const {http}=createApp();http.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('ShatterOS listening on port '+(process.env.PORT||3000)));}
module.exports={createApp};

