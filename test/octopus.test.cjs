const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp}=require('../server.cjs');
test('ShatterOS serves mesh and routes browser and Needle nodes',async t=>{
 const app=createApp();await new Promise(r=>app.http.listen(0,r));t.after(()=>app.close());
 const base='http://localhost:'+app.http.address().port+'/octopus/';
 const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/OCTOPUS/);
 async function api(m){const r=await fetch(base+'api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)});assert.equal(r.status,200);return r.json();}
 const room='TEST-ROOM';const a=await api({room,type:'join',name:'Browser',role:'sense'}),b=await api({room,type:'join',name:'GhostNode',role:'needle'});
 const nodes=await api({room,type:'poll',id:a.id,token:a.token,since:0});assert.equal(nodes.nodes.find(n=>n.id===b.id).role,'needle');
 await api({room,type:'send',id:a.id,token:a.token,to:b.id,event:{kind:'task',data:{id:'sample',text:'Read battery'}}});
 const received=await api({room,type:'poll',id:b.id,token:b.token,since:0});assert.equal(received.events[0].data.text,'Read battery');
 await api({room,type:'send',id:b.id,token:b.token,to:a.id,event:{kind:'result',data:{id:'sample',answer:'reviewed'}}});
 const result=await api({room,type:'poll',id:a.id,token:a.token,since:0});assert.equal(result.events.at(-1).data.answer,'reviewed');
});
