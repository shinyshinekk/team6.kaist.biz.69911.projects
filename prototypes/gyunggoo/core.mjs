export class BoardError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new BoardError(status,message);};
export const actors=[{id:'M-A',name:'주선자 A',role:'matchmaker'},{id:'M-B',name:'주선자 B',role:'matchmaker'},{id:'M-C',name:'무관한 주선자 C',role:'matchmaker'},...Array.from({length:10},(_,i)=>({id:'S-'+String(i+1).padStart(2,'0'),name:'싱글 '+String(i+1).padStart(2,'0'),role:'single'}))];
export const pairs=Array.from({length:5},(_,i)=>({id:'PAIR-'+(i+1),singles:['S-'+String(2*i+1).padStart(2,'0'),'S-'+String(2*i+2).padStart(2,'0')],owners:['M-A','M-B']}));
const copy=x=>structuredClone(x);
const full=keys=>Object.fromEntries(keys.map(k=>[k,true]));
const empty=keys=>Object.fromEntries(keys.map(k=>[k,false]));
export function actorFor(id){return actors.find(a=>a.id===id)||fail(401,'합성 테스트 역할을 선택하세요.');}
function makeCase(id,pair,at){return {id,pairId:pair.id,owners:[...pair.owners],singles:[...pair.singles],reviews:empty(pair.owners),accepted:empty(pair.singles),disclosed:empty(pair.singles),connected:empty(pair.owners),followup:null,held:false,closed:false,createdAt:at,updatedAt:at,events:[{at,label:'소개 건 생성'}]};}
export function seed(at='2026-10-28T00:00:00.000Z'){
 const cases=Array.from({length:4},(_,i)=>makeCase('TTU-'+(101+i),pairs[i],at));
 cases[0].reviews['M-A']=true;
 for(const c of cases.slice(1))c.reviews=full(c.owners);
 for(const c of cases.slice(2))c.accepted=full(c.singles);
 cases[2].disclosed['S-05']=true;
 cases[3].disclosed=full(cases[3].singles);cases[3].connected=full(cases[3].owners);
 return {schema:1,version:0,nextId:105,cases,receipts:{}};
}
const all=map=>Object.values(map).length>0&&Object.values(map).every(v=>v===true);
export function phase(c){
 if(c.closed)return 'closed';if(c.held)return 'held';
 if(!all(c.reviews))return 'review';if(!all(c.accepted))return 'consent';if(!all(c.disclosed))return 'disclosure';if(!all(c.connected))return 'connection';return c.followup===null?'followup':'done';
}
export const phaseLabels={review:'주선자 검토',consent:'소개 동의',disclosure:'공유 동의',connection:'연결 확인',followup:'후속 확인',done:'정리 완료',held:'잠시 보류',closed:'소개 종료'};
const member=(c,a)=>c.owners.includes(a.id)||c.singles.includes(a.id);
export function available(c,a){
 const p=phase(c),out=[];if(!member(c,a)||c.closed)return out;
 if(a.role==='matchmaker'){
  if(c.held)return [{type:'resume',label:'보류 해제'}];
  if(p==='review'&&!c.reviews[a.id])out.push({type:'review',label:'이 소개 검토 완료'});
  if(p==='review')out.push({type:'decline',label:'이 소개 검토 거절'});
  if(p==='connection'&&!c.connected[a.id])out.push({type:'connect',label:'합성 연결 완료 확인'});
  if(['followup','done'].includes(p))out.push({type:'followup',label:'후속 확인 저장'});
  if(!['followup','done'].includes(p))out.push({type:'hold',label:'잠시 보류'});
 }else{
  if(!c.held&&p==='consent'&&!c.accepted[a.id])out.push({type:'accept',label:'소개 수락'},{type:'decline',label:'소개 거절'});
  if(!c.held&&p==='disclosure'&&!c.disclosed[a.id])out.push({type:'disclose',label:'연락 공유 별도 승인'});
  out.push({type:'withdraw',label:'참여 철회'});
 }
 return out;
}
export function nextAction(c,a){
 const p=phase(c),own=available(c,a);
 if(p==='closed')return '이번 소개는 종료됐어요. 새 연락을 발송하지 않아요.';
 if(p==='held')return '보류한 내용을 확인한 뒤 진행을 재개하세요.';
 if(p==='done')return '후속 기록을 남겼어요. 실제 만남과 소개 연결은 구분해요.';
 const act=own.find(x=>!['hold','withdraw','decline'].includes(x.type));
 if(act)return {review:'이 소개를 검토하고 확인해 주세요.',accept:'내 소개 참여 여부를 선택해 주세요.',disclose:'연락 정보 공유 여부를 별도로 승인해 주세요.',connect:'실제로 연결했는지 확인해 주세요.',followup:'소개 후 실제 만남 여부를 기록해 주세요.'}[act.type];
 return {review:'다른 주선자의 검토를 기다리고 있어요.',consent:'싱글의 개별 소개 응답을 기다리고 있어요.',disclosure:'별도 정보 공유 승인을 기다리고 있어요.',connection:'다른 주선자의 실제 연결 확인을 기다리고 있어요.',followup:'소개 후 실제 만남 여부를 확인해 주세요.'}[p];
}
function project(c,a){
 const p=phase(c),isOwner=a.role==='matchmaker';
 return {id:c.id,pairId:c.pairId,title:c.singles.join(' · '),owners:c.owners,phase:p,phaseLabel:phaseLabels[p],nextAction:nextAction(c,a),createdAt:c.createdAt,updatedAt:c.updatedAt,followup:c.followup,synthetic:true,
  introduced:all(c.connected),actions:available(c,a),events:c.closed?c.events.map(e=>({at:e.at,label:e.label==='소개 건 생성'?e.label:'진행 기록 반영'})):c.events,
  progress:c.closed?null:{review:all(c.reviews),consent:all(c.accepted),disclosure:all(c.disclosed),connection:all(c.connected),followup:c.followup!==null},
  checks:c.closed?[]:isOwner?[...c.owners.map(id=>({label:id+' 검토',ok:c.reviews[id]})),...c.singles.flatMap(id=>[{label:id+' 소개 수락',ok:c.accepted[id]},{label:id+' 별도 공유 승인',ok:c.disclosed[id]}]),...c.owners.map(id=>({label:id+' 연결 확인',ok:c.connected[id]}))]:[{label:'내 소개 수락',ok:c.accepted[a.id]},{label:'내 별도 공유 승인',ok:c.disclosed[a.id]}]};
}
export function snapshot(state,actorId){
 const a=actorFor(actorId),cases=state.cases.filter(c=>member(c,a)).map(c=>project(c,a));
 return {schema:1,version:state.version,actor:a,actors,synthetic:true,cases,pairs:a.role==='matchmaker'?pairs.filter(p=>p.owners.includes(a.id)):[],summary:{active:cases.filter(c=>!['held','closed','done'].includes(c.phase)).length,held:cases.filter(c=>c.phase==='held').length,introduced:cases.filter(c=>c.introduced).length,closed:cases.filter(c=>c.phase==='closed').length}};
}
export function reduce(state,actorId,command,at=new Date().toISOString()){
 const a=actorFor(actorId);if(!command||typeof command!=='object')fail(400,'요청 형식이 올바르지 않습니다.');
 const {type,caseId,eventId,version}=command;
 if(typeof eventId!=='string'||!/^[A-Za-z0-9-]{8,80}$/.test(eventId))fail(400,'요청 식별자가 필요합니다.');
 const fingerprint=JSON.stringify({actorId,type,caseId,pairId:command.pairId,value:command.value});
 const receiptKey=actorId+':'+eventId;
 if(state.receipts[receiptKey]){if(state.receipts[receiptKey]!==fingerprint)fail(409,'같은 요청 ID에 다른 내용을 보낼 수 없습니다.');return state;}
 if(version!==state.version)fail(409,'다른 변경이 먼저 저장됐습니다. 최신 상태를 읽고 다시 확인하세요.');
 const next=copy(state);let c,label;
 if(type==='create'){
  const pair=pairs.find(p=>p.id===command.pairId&&p.owners.includes(a.id));
  if(a.role!=='matchmaker'||!pair)fail(403,'허용된 합성 후보 쌍만 선택할 수 있습니다.');
  if(next.cases.some(x=>x.pairId===pair.id&&!x.closed))fail(409,'이 후보 쌍의 소개가 이미 있습니다.');
  c=makeCase('TTU-'+next.nextId++,pair,at);next.cases.unshift(c);label='소개 건 생성';
 }else{
  c=next.cases.find(x=>x.id===caseId);if(!c||!member(c,a))fail(404,'접근 가능한 소개 건이 없습니다.');
  if(!available(c,a).some(x=>x.type===type))fail(403,'이 역할 또는 현재 단계에서는 할 수 없는 동작입니다.');
  switch(type){
   case 'review':c.reviews[a.id]=true;label='주선자 검토 반영';break;
   case 'accept':c.accepted[a.id]=true;label='소개 참여자 응답 반영';break;
   case 'decline':case 'withdraw':c.closed=true;c.held=false;label='소개 진행 종료';break;
   case 'disclose':c.disclosed[a.id]=true;label='별도 공유 승인 반영';break;
   case 'connect':c.connected[a.id]=true;label=all(c.connected)?'양쪽 주선자 연결 확인':'주선자 연결 확인 반영';break;
   case 'followup':if(!['met','not_met','unknown'].includes(command.value))fail(400,'후속 확인 값을 선택하세요.');c.followup=command.value;label='후속 확인 기록';break;
   case 'hold':c.held=true;label='진행 잠시 보류';break;
   case 'resume':c.held=false;label='진행 재개';break;
   default:fail(400,'지원하지 않는 동작입니다.');
  }
  c.events.push({at,label});
 }
 c.updatedAt=at;next.version++;
 next.receipts[receiptKey]=fingerprint;
 const keys=Object.keys(next.receipts);for(const key of keys.slice(0,Math.max(0,keys.length-1000)))delete next.receipts[key];
 assertState(next);return next;
}
export function assertState(s){
 const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
 if(!record(s)||s.schema!==1||!Number.isSafeInteger(s.version)||s.version<0||!Number.isSafeInteger(s.nextId)||s.nextId<105||!Array.isArray(s.cases)||!record(s.receipts))fail(500,'저장 데이터 형식이 다릅니다. 원본 파일을 보존하세요.');
 for(const [key,value]of Object.entries(s.receipts)){
  const parts=key.split(':');
  if(parts.length!==2||!actors.some(a=>a.id===parts[0])||!/^[A-Za-z0-9-]{8,80}$/.test(parts[1])||typeof value!=='string'||value.length>4096)fail(500,'저장 데이터 요청 기록이 올바르지 않습니다.');
 }
 const ids=new Set(),activePairs=new Set();for(const c of s.cases){
  if(!record(c)||typeof c.id!=='string'||!/^TTU-[1-9][0-9]{2,}$/.test(c.id)||!Number.isSafeInteger(Number(c.id.slice(4)))||Number(c.id.slice(4))>=s.nextId||!time(c.createdAt)||!time(c.updatedAt))fail(500,'저장 데이터 식별자·시각이 올바르지 않습니다.');
  const pair=pairs.find(p=>p.id===c.pairId);
  if(!pair||ids.has(c.id)||JSON.stringify(c.owners)!==JSON.stringify(pair.owners)||JSON.stringify(c.singles)!==JSON.stringify(pair.singles)||typeof c.held!=='boolean'||typeof c.closed!=='boolean'||c.held&&c.closed||!Array.isArray(c.events)||!c.events.length||c.events.some(e=>!record(e)||!time(e.at)||typeof e.label!=='string'||!e.label.trim()))fail(500,'저장 데이터 관계·이벤트가 올바르지 않습니다.');ids.add(c.id);
  if(!c.closed){if(activePairs.has(c.pairId))fail(500,'진행 중인 후보 쌍이 중복 저장됐습니다.');activePairs.add(c.pairId);}
  for(const [field,keys] of [['reviews',c.owners],['accepted',c.singles],['disclosed',c.singles],['connected',c.owners]]){
   if(!c[field]||Object.keys(c[field]).sort().join()!==[...keys].sort().join()||Object.values(c[field]).some(v=>typeof v!=='boolean'))fail(500,'저장 데이터 응답이 올바르지 않습니다.');
  }
  if((Object.values(c.accepted).some(Boolean)&&!all(c.reviews))||(Object.values(c.disclosed).some(Boolean)&&!all(c.accepted))||(Object.values(c.connected).some(Boolean)&&!all(c.disclosed))||(c.followup!==null&&!all(c.connected)))fail(500,'저장 데이터의 선행 동의가 누락됐습니다.');
  if(c.followup!==null&&!['met','not_met','unknown'].includes(c.followup))fail(500,'저장 데이터 후속 상태가 다릅니다.');
 }
 return s;
}
