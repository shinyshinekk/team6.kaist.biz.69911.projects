import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {seed,snapshot} from '../core.mjs';
const source=await fs.readFile(new URL('../app.mjs',import.meta.url),'utf8');
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.options=[];this.value='';this.open=false;this.hidden=false;this.disabled=false;this.textContent='';}
 append(...x){this.children.push(...x);}replaceChildren(...x){this.children=[...x];if(this.tag==='select'){this.options=[];this.value='';}}
 setAttribute(){}add(o){this.options.push(o);if(!this.value)this.value=o.value;}close(){this.open=false;}showModal(){this.open=true;}
}
async function app(){
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element(id==='pair'?'select':'div'));return elements.get(id);};
 const document={getElementById:element,createElement:tag=>new Element(tag)};element('filter').value='all';
 const pending=[];let initial=true,serial=0;
 const fetch=async(url,options)=>{if(initial){initial=false;return {ok:true,json:async()=>snapshot(seed(),'M-A')};}return new Promise(resolve=>pending.push({url,options,resolve:(data,ok=true)=>resolve({ok,json:async()=>data}),reject:()=>resolve({ok:false,json:async()=>({error:'최신 상태를 읽고 다시 확인하세요.'})})}));};
 await vm.runInNewContext('(async()=>{'+source+'})()',{document,fetch,Option:class{constructor(text,value){this.text=text;this.value=value;}},crypto:{randomUUID:()=>`ui-event-${++serial}`},console});
 return {element,pending};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('latest role wins even when responses arrive in reverse order; old data is hidden while reading',async()=>{
 const {element:e,pending:p}=await app();e('actor').value='M-B';const b=e('actor').onchange();assert.equal(e('board').children.length,0);assert.equal(e('new').disabled,true);
 e('actor').value='M-C';const c=e('actor').onchange();p[1].resolve(snapshot(seed(),'M-C'));await c;assert.equal(e('active').textContent,0);
 p[0].resolve(snapshot(seed(),'M-B'));await b;assert.equal(e('actor').value,'M-C');assert.equal(e('active').textContent,0);assert.equal(e('new').hidden,true);
});
test('latest manual refresh wins and a stale error cannot replace a successful result',async()=>{
 const {element:e,pending:p}=await app(),first=e('refresh').onclick(),second=e('refresh').onclick();
 const next=seed();next.cases=[];p[1].resolve(snapshot(next,'M-A'));await second;p[0].reject();await first;
 assert.equal(e('active').textContent,0);assert.equal(e('message').textContent,'');assert.equal(e('refresh').disabled,false);
});
test('pending create locks actor/reset/read controls and repeated clicks submit only once',async()=>{
 const {element:e,pending:p}=await app();e('new').onclick();e('pair').value='PAIR-5';const create=e('create-submit').onclick();
 assert.equal(e('actor').disabled,true);assert.equal(e('refresh').disabled,true);assert.equal(e('reset').disabled,true);assert.equal(e('new').disabled,true);
 await e('create-submit').onclick();await e('refresh').onclick();await e('reset').onclick();e('actor').value='M-C';await e('actor').onchange();assert.equal(e('actor').value,'M-A');assert.equal(p.length,1);
 p[0].resolve(snapshot(seed(),'M-A'));await create;assert.equal(e('actor').disabled,false);assert.equal(e('create-submit').disabled,false);
});
test('create conflict refreshes state before retry and uses the new version',async()=>{
 const {element:e,pending:p}=await app();e('new').onclick();e('pair').value='PAIR-5';const create=e('create-submit').onclick();p[0].reject();await flush();assert.equal(p[1].url,'/api/state');
 const fresh=seed();fresh.version=7;p[1].resolve(snapshot(fresh,'M-A'));await create;assert.equal(e('create').open,true);assert.ok(e('create-message').textContent);
 const retry=e('create-submit').onclick();assert.equal(JSON.parse(p[2].options.body).version,7);p[2].resolve(snapshot(fresh,'M-A'));await retry;
});
test('a failed current read leaves stale board and mutation controls unavailable until a successful read',async()=>{
 const {element:e,pending:p}=await app();const failed=e('refresh').onclick();p[0].reject();await failed;
 assert.equal(e('board').children.length,0);assert.equal(e('new').disabled,true);assert.equal(e('reset').disabled,true);assert.equal(e('refresh').disabled,false);
 const retried=e('refresh').onclick();p[1].resolve(snapshot(seed(),'M-A'));await retried;assert.equal(e('new').disabled,false);assert.equal(e('active').textContent,4);
});
