/* TTU F18: deterministic in-memory simulation. Synthetic participants only.
 * No network, actual user identity, access token, AI inference or database.
 * Business rules are not a substitute for server-side authentication/authorization.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root)root.TtuEngine=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const DAY=86400000, HOUR=3600000;
  const START=Date.parse('2026-10-29T01:30:00+09:00');
  const MATCHMAKERS=[{id:'M1',label:'주선자 M1 · 민지 (가상)'},{id:'M2',label:'주선자 M2 · 준호 (가상)'}];
  const KEYWORDS=['대화가 편안한 사람','취미를 나누는 사람','활동적인 사람','차분한 사람','서로의 일을 존중하는 사람','새로운 경험을 즐기는 사람'];
  const RECEIVED='received',REVIEWING='reviewing';
  const TERMINAL={withdrawn:'closed/withdrawn_by_single',unlinked:'closed/link_removed',expired:'closed/expired_inactive',possible:'closed/possible_later',cannot:'closed/cannot_proceed'};
  const labels={received:'접수됨',reviewing:'검토 중',closed:'종료'};
  function fail(reason){throw new Error(reason);}
  function initial(){return {now:START,connected:['M1','M2'],visibility:'L0',cardsAvailable:0,active:[],archives:{M1:[],M2:[]},lastSubmitted:{M1:null,M2:null},nextId:1,events:{preference_nudge_submitted:0,proposal_created:0,mutually_accepted:0,introduced:0}};}
  function clone(s){return JSON.parse(JSON.stringify(s));}
  function clean(v){return String(v??'').trim();}
  function countCodepoints(v){return [...String(v)].length;}
  function forbidden(v){
    const value=clean(v);
    return /(?:https?:\/\/|www\.)\S+/i.test(value)
      || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)
      || /(?:^|\D)(?:01[016789][\s.-]?\d{3,4}[\s.-]?\d{4})(?:\D|$)/.test(value)
      || /(?:^|\D)\d{6}[\s-]?[1-4]\d{6}(?:\D|$)/.test(value)
      || /(?:연락처|전화번호|주민등록번호|카카오톡\s*아이디|카톡\s*아이디|인스타\s*아이디|집\s*주소|실명)/i.test(value);
  }
  function displayStatus(st){
    if(st===RECEIVED)return '접수됨';if(st===REVIEWING)return '검토 중';
    if(st===TERMINAL.withdrawn)return '종료 · 내가 철회함';
    if(st===TERMINAL.expired)return '종료 · 기한 만료';
    if(st===TERMINAL.unlinked)return '종료 · 연결 해제';
    return '종료';
  }
  function oneTimeArchive(next,r,status){
    // The audit record contains only request ID, timestamps and a coded status.
    // No tags, note, sensitive text or internal reason outside coded status.
    next.archives[r.to].push({id:r.id,submittedAt:r.submittedAt,closedAt:next.now,status});
    next.active=next.active.filter(a=>a.id!==r.id);
  }
  function sweep(s){
    const next=clone(s);
    for(const r of [...next.active]){
      if(next.now>=r.expiresAt)oneTimeArchive(next,r,TERMINAL.expired);
    }
    return next;
  }
  function submit(state,input){
    const s=sweep(state),recipient=clean(input.recipient);
    if(!s.connected.includes(recipient))fail('현재 연결 중인 주선자 한 명을 지정해야 합니다.');
    const tags=Array.isArray(input.tags)?input.tags.map(clean):[];
    if(tags.length<1||tags.length>3||new Set(tags).size!==tags.length||tags.some(t=>!KEYWORDS.includes(t)))fail('허용된 스타일 키워드 1~3개를 중복 없이 선택하세요.');
    const description=clean(input.description);
    if(countCodepoints(description)>120)fail('자유 설명은 120자 이하로 작성하세요.');
    if(forbidden(description))fail('연락처·링크·개인정보 가능성이 있는 내용이 감지됐습니다. 수정 후 다시 제출하세요.');
    if(input.confirmed!==true)fail('받는 주선자와 전달할 내용을 확인한 뒤 제출하세요.');
    if(s.active.some(r=>r.to===recipient))fail('이 주선자에게 진행 중인 요청이 이미 있습니다.');
    const previous=s.lastSubmitted[recipient];
    if(previous!==null&&s.now-previous<24*HOUR)fail('같은 주선자에게는 마지막 요청 제출 후 24시간이 지나야 새 요청을 보낼 수 있습니다.');
    const r={id:'N'+String(s.nextId).padStart(3,'0'),to:recipient,tags,description,status:RECEIVED,
      submittedAt:s.now,firstReviewedAt:null,expiresAt:s.now+7*DAY};
    s.nextId+=1;s.active.push(r);s.lastSubmitted[recipient]=s.now;s.events.preference_nudge_submitted+=1;
    return s;
  }
  function getOwnActive(s,id){const r=s.active.find(r=>r.id===id);if(!r)fail('진행 중인 요청을 찾을 수 없습니다.');return r;}
  function startReview(state,id,recipient){
    const s=sweep(state),r=getOwnActive(s,id);
    if(!s.connected.includes(recipient)||r.to!==recipient)fail('이 주선자는 해당 요청을 열람할 수 없습니다.');
    if(r.status!==RECEIVED)fail('이미 검토 중이거나 종료된 요청입니다.');
    r.status=REVIEWING;r.firstReviewedAt=s.now;r.expiresAt=s.now+7*DAY; // one-time reset (Q11)
    return s;
  }
  function closeByMatchmaker(state,id,recipient,disposition){
    const s=sweep(state),r=getOwnActive(s,id);
    if(!s.connected.includes(recipient)||r.to!==recipient)fail('이 주선자는 요청을 종료할 수 없습니다.');
    if(r.status!==REVIEWING)fail('검토를 시작한 뒤 종료할 수 있습니다.');
    if(!['possible_later','cannot_proceed'].includes(disposition))fail('검토 결과 유형이 유효하지 않습니다.');
    oneTimeArchive(s,r,disposition==='possible_later'?TERMINAL.possible:TERMINAL.cannot);
    return s;
  }
  function withdraw(state,id){
    const s=sweep(state),r=getOwnActive(s,id);
    oneTimeArchive(s,r,TERMINAL.withdrawn);
    return s;
  }
  function unlink(state,recipient){
    const s=sweep(state);
    if(!s.connected.includes(recipient))fail('이미 연결 해제된 주선자입니다.');
    s.connected=s.connected.filter(id=>id!==recipient);
    for(const r of [...s.active.filter(r=>r.to===recipient)])oneTimeArchive(s,r,TERMINAL.unlinked);
    return s;
  }
  function inbox(state,recipient){
    const s=sweep(state);
    if(!s.connected.includes(recipient))return [];
    return s.active.filter(r=>r.to===recipient).map(r=>clone(r));
  }
  function myRequests(state){
    const s=sweep(state);
    const open=s.active.map(r=>({...clone(r),isArchived:false}));
    const closed=Object.entries(s.archives).flatMap(([to,items])=>items.map(a=>({...clone(a),to,isArchived:true})));
    return [...open,...closed].sort((a,b)=>b.submittedAt-a.submittedAt||b.id.localeCompare(a.id));
  }
  function audits(state,recipient){return clone(state.archives[recipient]||[]);}
  function advanceTime(state,hours){
    if(!Number.isFinite(hours)||hours<=0||hours>24*365)fail('시연 시간은 0~365일 범위에서 이동할 수 있습니다.');
    const s=clone(state);s.now+=hours*HOUR;return sweep(s);
  }
  return {DAY,HOUR,START,MATCHMAKERS,KEYWORDS,TERMINAL,labels,initial,clone,forbidden,displayStatus,sweep,submit,startReview,closeByMatchmaker,withdraw,unlink,inbox,myRequests,audits,advanceTime};
});
