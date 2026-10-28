import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {openStore} from '../store.mjs';import {createServer} from '../server.mjs';
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
});
