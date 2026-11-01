// Deterministic discrete-event model, not a measurement of real phones or networks.
// Each architecture handles the same generated tasks/failures. See README for assumptions.
import { pathToFileURL } from 'node:url';
export function simulate({seed=42,count=10000}={}) {
 let rng=seed>>>0;const random=()=>((rng=(Math.imul(rng,1664525)+1013904223)>>>0)/2**32);
 const workload=Array.from({length:count},()=>({local:random()<.55,hubUp:random()>=.12,peerUp:random()>=.08,linkUp:random()>=.04,jitter:Math.floor(random()*30)}));
 const models={
  centralized(t){if(!t.hubUp||!t.linkUp)return null;return {ms:90+t.jitter,bytes:1800}},
  decentralized(t){if(t.local)return {ms:12+t.jitter/4,bytes:0};if(!t.peerUp||!t.linkUp)return null;return {ms:48+t.jitter,bytes:1200}},
  hybrid(t){if(t.local)return {ms:12+t.jitter/4,bytes:0};if(!t.linkUp)return null;if(t.peerUp)return {ms:48+t.jitter,bytes:1200};if(t.hubUp)return {ms:150+t.jitter,bytes:2400};return null}
 };
 return Object.fromEntries(Object.entries(models).map(([name,fn])=>{const results=workload.map(fn),success=results.filter(Boolean),times=success.map(x=>x.ms).sort((a,b)=>a-b);const percentile=p=>times.length?times[Math.min(times.length-1,Math.ceil(times.length*p)-1)]:null;return [name,{tasks:count,completed:success.length,success_rate:success.length/count,p50_ms:percentile(.5),p95_ms:percentile(.95),bytes_per_attempt:success.reduce((a,x)=>a+x.bytes,0)/count,power:'not measured'}]}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({type:'simulation, not device benchmark',seed:42,assumptions:'55% local tasks; independent 12% hub, 8% peer, 4% link outage; modeled latencies and payload bytes',results:simulate()},null,2));
