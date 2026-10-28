import test from 'node:test';import assert from 'node:assert/strict';
import {seed,reduce,phase,snapshot,assertState} from '../core.mjs';
let serial=0;const event=()=>`test-event-${++serial}`;
const run=(s,actor,type,extra={})=>reduce(s,actor,{type,eventId:event(),version:s.version,...extra},'2026-10-28T04:00:00.000Z');
test('one introduction completes only after independent review, consent, disclosure and both connection confirmations',()=>{
 let s=run(seed(),'M-A','create',{pairId:'PAIR-5'}),id='TTU-105';
 const act=(actor,type,extra={})=>{s=run(s,actor,type,{caseId:id,...extra});};const c=()=>s.cases.find(x=>x.id===id);
 act('M-A','review');assert.equal(phase(c()),'review');act('M-B','review');assert.equal(phase(c()),'consent');
 act('S-09','accept');assert.equal(phase(c()),'consent');act('S-10','accept');assert.equal(phase(c()),'disclosure');
 assert.equal(snapshot(s,'M-A').cases.find(x=>x.id===id).introduced,false);
 act('S-09','disclose');assert.equal(phase(c()),'disclosure');act('S-10','disclose');assert.equal(phase(c()),'connection');
 act('M-A','connect');assert.equal(phase(c()),'connection');act('M-B','connect');assert.equal(phase(c()),'followup');
 act('M-A','followup',{value:'unknown'});assert.equal(phase(c()),'done');assert.equal(c().followup,'unknown');
});
test('matchmakers cannot answer for singles or jump disclosure/connection gates',()=>{
 const s=seed();for(const [actor,type,id]of [['M-A','accept','TTU-102'],['S-03','disclose','TTU-102'],['M-A','connect','TTU-103'],['S-01','accept','TTU-101']])assert.throws(()=>run(s,actor,type,{caseId:id}),e=>e.status===403);
 assert.equal(s.version,0);
});
test('unrelated actor sees no cases and cannot change or create their pair',()=>{
 const s=seed();assert.deepEqual(snapshot(s,'M-C').cases,[]);assert.deepEqual(snapshot(s,'M-C').pairs,[]);
 assert.throws(()=>run(s,'M-C','hold',{caseId:'TTU-101'}),e=>e.status===404);assert.throws(()=>run(s,'M-C','create',{pairId:'PAIR-5'}),e=>e.status===403);
});
test('hold pauses progression without erasing approvals; resume restores underlying phase',()=>{
 let s=run(seed(),'M-A','hold',{caseId:'TTU-103'});assert.equal(phase(s.cases[2]),'held');
 assert.throws(()=>run(s,'S-06','disclose',{caseId:'TTU-103'}),e=>e.status===403);
 s=run(s,'M-B','resume',{caseId:'TTU-103'});assert.equal(phase(s.cases[2]),'disclosure');assert.equal(s.cases[2].disclosed['S-05'],true);
});
test('decline/withdraw terminates immediately and hides identity, reason and individual checks from shared view',()=>{
 for(const type of ['decline','withdraw']){let s=run(seed(),'S-03',type,{caseId:'TTU-102'});const c=snapshot(s,'M-A').cases.find(x=>x.id==='TTU-102');assert.equal(c.phase,'closed');assert.deepEqual(c.checks,[]);assert.equal(c.progress,null);assert.equal(c.actions.length,0);assert.ok(c.events.every(e=>!e.label.includes('S-03')));assert.throws(()=>run(s,'M-A','review',{caseId:'TTU-102'}),e=>e.status===403);}
});
test('repeated request ID is idempotent but reuse with changed contents is rejected',()=>{
 const s=seed(),cmd={type:'hold',caseId:'TTU-101',eventId:event(),version:s.version},next=reduce(s,'M-A',cmd);
 assert.equal(reduce(next,'M-A',cmd),next);assert.equal(next.cases[0].events.length,2);
 assert.throws(()=>reduce(next,'M-A',{...cmd,type:'resume'}),e=>e.status===409);
});
test('stale versions and duplicate active candidate pairs cannot create misleading progress',()=>{
 const s=run(seed(),'M-A','hold',{caseId:'TTU-101'});assert.throws(()=>reduce(s,'M-B',{type:'review',caseId:'TTU-101',eventId:event(),version:0}),e=>e.status===409);
 assert.throws(()=>run(s,'M-A','create',{pairId:'PAIR-1'}),e=>e.status===409);
});
test('followup is independent from introduction and cannot be recorded early',()=>{
 const s=seed();assert.throws(()=>run(s,'M-A','followup',{caseId:'TTU-103',value:'met'}),e=>e.status===403);
 const next=run(s,'M-A','followup',{caseId:'TTU-104',value:'not_met'});assert.equal(snapshot(next,'M-A').summary.introduced,1);assert.equal(next.cases[3].followup,'not_met');
 assert.throws(()=>run(s,'M-A','followup',{caseId:'TTU-104',value:'married'}),e=>e.status===400);
});
test('post-introduction withdrawal ends participation without erasing the prior connection aggregate',()=>{
 const next=run(seed(),'S-07','withdraw',{caseId:'TTU-104'});assert.equal(phase(next.cases[3]),'closed');assert.equal(snapshot(next,'M-A').summary.introduced,1);
});
test('saved data with impossible consent dependencies fails validation',()=>{
 const s=seed();s.cases[0].connected['M-A']=true;assert.throws(()=>assertState(s),e=>e.status===500);
});
test('a matchmaker can reject during review; closure is generic and cannot be resumed',()=>{
 const s=run(seed(),'M-A','decline',{caseId:'TTU-101'}),c=snapshot(s,'M-B').cases.find(x=>x.id==='TTU-101');
 assert.equal(c.phase,'closed');assert.deepEqual(c.actions,[]);assert.deepEqual(c.checks,[]);assert.ok(c.events.every(e=>!e.label.includes('M-A')));
 assert.throws(()=>run(s,'M-B','resume',{caseId:'TTU-101'}),e=>e.status===403);
 assert.throws(()=>run(seed(),'M-A','decline',{caseId:'TTU-102'}),e=>e.status===403);
 for(const a of ['M-A','M-B','S-01','S-03'])for(const x of snapshot(seed(),a).cases)assert.equal(typeof x.nextAction,'string');
});
test('valid JSON with malformed events, identifiers, counters or receipt containers is rejected',()=>{
 const corruptions=[s=>{s.cases[0].closed=true;s.cases[0].events=[null];},s=>{s.nextId=104;},s=>{s.receipts=[];},s=>{s.cases[0].id=null;},s=>{s.cases[0].updatedAt='yesterday';},s=>{s.version=-1;},s=>{s.receipts.foo='anything';},s=>{s.cases[0].events[0].label=42;},s=>{s.cases[0].held=s.cases[0].closed=true;},s=>{const c=structuredClone(s.cases[0]);c.id='TTU-104';s.cases[3]=c;}];
 for(const corrupt of corruptions){const s=seed();corrupt(s);assert.throws(()=>assertState(s),e=>e.status===500);}
});
