import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Ephemeral trusted-LAN relay. Nodes execute tasks; the relay only queues envelopes.
export function createMeshServer() {
 const rooms=new Map();
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/app.js' || url.pathname==='/style.css')) {
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   try {const data=await readFile(new URL('./public/'+file,import.meta.url));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});return res.end(data);}catch{return res.writeHead(404).end();}
  }
  if(req.method!=='POST'||url.pathname!=='/api') return res.writeHead(404).end();
  let body=''; for await(const chunk of req){body+=chunk;if(body.length>16384)return res.writeHead(413).end();}
  let m;try{m=JSON.parse(body);}catch{return res.writeHead(400).end();}
  const out=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(!m || typeof m.room!=='string' || !/^[A-Z0-9-]{4,32}$/.test(m.room))return out(400,{error:'Invalid room'});
  let room=rooms.get(m.room);
  if(m.type==='join') {
   if(!room){if(rooms.size>=100)return out(429,{error:'Server full'});room={nodes:new Map(),events:[],seq:0};rooms.set(m.room,room);}
   if(room.nodes.size>=16)return out(429,{error:'Room full'});
   const id=randomBytes(8).toString('hex'), token=randomBytes(24).toString('hex');
   room.nodes.set(id,{id,token,name:String(m.name||'Node').slice(0,24),role:['sense','memory','synthesis'].includes(m.role)?m.role:'sense',last:Date.now()});
   return out(200,{id,token});
  }
  const n=room?.nodes.get(m.id);if(!n||n.token!==m.token)return out(403,{error:'Unknown node'});
  n.last=Date.now();
  if(m.type==='poll'){
   for(const [id,node] of room.nodes)if(Date.now()-node.last>15000)room.nodes.delete(id);
   return out(200,{nodes:[...room.nodes.values()].map(({token,...x})=>x),events:room.events.filter(e=>e.seq>(Number(m.since)||0) && (!e.to || e.to===n.id || e.from===n.id))});
  }
  if(m.type==='send'){
   if(!m.event||!['task','result','memory','pulse'].includes(m.event.kind)||JSON.stringify(m.event).length>4096)return out(400,{error:'Invalid event'});
   const e={seq:++room.seq,from:n.id,to:typeof m.to==='string'?m.to:null,time:Date.now(),...{kind:m.event.kind,data:m.event.data}};
   room.events.push(e);if(room.events.length>500)room.events.shift();return out(200,{seq:e.seq,bytes:Buffer.byteLength(JSON.stringify(e))});
  }
  if(m.type==='leave'){room.nodes.delete(n.id);if(!room.nodes.size)rooms.delete(m.room);return out(200,{ok:true});}
  return out(400,{error:'Unknown operation'});
 });
 return {server,rooms};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {server}=createMeshServer();server.listen(Number(process.env.PORT)||8787,'0.0.0.0',()=>console.log('Octopus Mesh listening on port '+(process.env.PORT||8787)));
}
