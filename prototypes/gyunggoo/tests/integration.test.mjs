import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {openStore} from '../store.mjs';import {createServer} from '../server.mjs';
import {seed} from '../core.mjs';
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'ttu-hw6-test-'));
test('atomic persistence survives reopening; failed writes do not change the in-memory state',async()=>{
 const dir=await temp(),file=path.join(dir,'board.local.json'),store=await openStore(file);
 await store.dispatch('M-A',{type:'hold',caseId:'TTU-101',version:0,eventId:'persist-0001'});
 const reopened=await openStore(file);assert.equal(reopened.read().cases[0].held,true);assert.equal(reopened.read().version,1);
 const blocked=path.join(dir,'blocked'),badStore=await openStore(path.join(blocked,'data.json'));await fs.writeFile(blocked,'obstruction');
 await assert.rejects(badStore.dispatch('M-A',{type:'hold',caseId:'TTU-101',version:0,eventId:'failed-0001'}));assert.equal(badStore.read().version,0);assert.equal(badStore.read().cases[0].held,false);
});
test('malformed disk data is preserved instead of silently reset',async()=>{
 const file=path.join(await temp(),'broken.json');await fs.writeFile(file,'not-json');await assert.rejects(openStore(file));assert.equal(await fs.readFile(file,'utf8'),'not-json');
});
test('semantically corrupted JSON is rejected before serving and its bytes are preserved',async()=>{
 const s=seed();s.cases[0].closed=true;s.cases[0].events=[null];const data=JSON.stringify(s);
 const file=path.join(await temp(),'corrupt.json');await fs.writeFile(file,data);await assert.rejects(openStore(file),e=>e.status===500);assert.equal(await fs.readFile(file,'utf8'),data);
});
test('queued simultaneous commands with one version save once and reject the stale change',async()=>{
 const store=await openStore(path.join(await temp(),'queued.json'));
 const results=await Promise.allSettled(['M-A','M-B'].map((a,i)=>store.dispatch(a,{type:'hold',caseId:'TTU-101',version:0,eventId:'queued-event-'+i})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);assert.equal(store.read().version,1);assert.equal(store.read().cases[0].events.length,2);
});
test('failed final rename preserves the in-memory state and allows a later retry',async()=>{
 const file=path.join(await temp(),'rename.json'),store=await openStore(file);await fs.mkdir(file);
 const cmd={type:'hold',caseId:'TTU-101',version:0,eventId:'rename-failure-1'};
 await assert.rejects(store.dispatch('M-A',cmd));assert.equal(store.read().version,0);assert.equal(store.read().cases[0].held,false);
 await fs.rmdir(file);await store.dispatch('M-A',cmd);assert.equal((await openStore(file)).read().version,1);
});
test('HTTP boundary enforces actor relationships, origin, version and private file whitelist',async t=>{
 const server=await createServer({dataFile:path.join(await temp(),'board.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const get=(actor,route='/api/state')=>fetch(base+route,{headers:{'X-Demo-Actor':actor}});
 const post=(actor,body,origin=base)=>fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Actor':actor,Origin:origin},body:JSON.stringify(body)});
 assert.equal((await get('UNKNOWN')).status,401);assert.equal((await get('M-C')).status,200);assert.equal((await (await get('M-C')).json()).cases.length,0);
 const cmd={type:'hold',caseId:'TTU-101',eventId:'http-action-1',version:0};assert.equal((await post('M-C',cmd)).status,404);assert.equal((await post('M-A',cmd,'https://other.example')).status,403);
 assert.equal((await post('M-A',cmd)).status,200);assert.equal((await post('M-B',{...cmd,eventId:'http-action-2'})).status,409);
 for(const route of ['/.data/board.local.json','/server.mjs','/core.mjs'])assert.equal((await get('M-A',route)).status,404);
 const final=await (await get('M-A')).json();assert.equal(final.version,1);assert.equal(final.cases[0].phase,'held');assert.equal(JSON.stringify(final).includes('receipts'),false);
 for(const [body,contentType,status] of [['{','application/json',400],['null','application/json',400],['{}','text/plain',415],[' '.repeat(4097),'application/json',413]]){
  const r=await fetch(base+'/api/action',{method:'POST',headers:{'Content-Type':contentType,'X-Demo-Actor':'M-A'},body});assert.equal(r.status,status);
 }
 for(const [file,mime]of [['whytree-gyunggoo.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],['whytree-gyunggoo-review.pdf','application/pdf']]){
  const r=await fetch(base+'/'+file);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),mime);assert.deepEqual(Buffer.from(await r.arrayBuffer()),await fs.readFile(new URL('../'+file,import.meta.url)));
 }
});
