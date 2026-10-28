const $=id=>document.getElementById(id);let state,actor='M-A',selected=null,busy=false,ready=false,detailError='',readSequence=0;
const followups={met:'만남 확인',not_met:'아직 만나지 않음',unknown:'미확인'};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function lockControls(){$('actor').disabled=busy;$('refresh').disabled=busy;for(const id of ['reset','new','filter','create-submit'])$(id).disabled=busy||!ready;}
async function api(path,body,requestActor=actor){const response=await fetch(path,{method:body?'POST':'GET',headers:{'X-Demo-Actor':requestActor,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(data.error||'처리하지 못했습니다.');return data;}
async function refresh(){
 const sequence=++readSequence,requestActor=actor;ready=false;lockControls();$('board').replaceChildren();$('empty').hidden=true;$('focus').textContent='선택한 역할의 보드를 읽고 있어요.';
 for(const key of ['active','held','introduced','closed'])$(key).textContent='—';
 try{const fresh=await api('/api/state',undefined,requestActor);if(sequence!==readSequence||requestActor!==actor)return;state=fresh;ready=true;render();}
 catch(e){if(sequence===readSequence&&requestActor===actor)$('message').textContent=e.message;}
 finally{if(sequence===readSequence)lockControls();}
}
function render(){
 if(!ready)return;
 if(!$('actor').options.length)for(const a of state.actors){const o=new Option(a.name+' · '+a.id,a.id);$('actor').add(o);}
 $('actor').value=actor;for(const key of ['active','held','introduced','closed'])$(key).textContent=state.summary[key];
 $('reset').hidden=actor!=='M-A';$('new').hidden=state.actor.role!=='matchmaker'||!state.pairs.length;
 const actionable=state.cases.find(c=>c.actions.some(a=>!['hold','withdraw','followup','decline'].includes(a.type)));
 $('focus').textContent=actionable?`${actionable.id} · ${actionable.nextAction}`:state.cases.length?'기다리는 절차와 후속 확인을 살펴보세요.':'이 역할이 참여한 소개가 없어요.';
 const filter=$('filter').value,cases=state.cases.filter(c=>filter==='all'||filter==='held'&&c.phase==='held'||filter==='ended'&&['done','closed'].includes(c.phase)||filter==='active'&&!['held','done','closed'].includes(c.phase));
 $('empty').hidden=cases.length>0;$('board').replaceChildren();
 const lanes=[['검토와 동의',['review','consent','disclosure','held']],['연결 확인',['connection']],['후속과 정리',['followup','done','closed']]];
 for(const [name,phases]of lanes){const lane=el('section',undefined,'lane'),items=cases.filter(c=>phases.includes(c.phase));lane.append(el('h3',name+'  '+items.length));
  for(const c of items){const card=el('article',undefined,'case');card.append(el('span',c.id,'case-id'),el('h4',c.title),el('span',c.phaseLabel,'pill '+c.phase),el('p',c.nextAction,'next'),el('div','협력 주선자 '+c.owners.join(' · '),'mini'));const b=el('button','상세와 다음 행동');b.setAttribute('aria-label',c.id+' 상세와 다음 행동');b.disabled=busy;b.onclick=()=>openDetail(c.id);card.append(b);lane.append(card);}
  if(!items.length)lane.append(el('p','이 단계의 소개가 없어요.','lane-empty'));$('board').append(lane);
 }
 if(selected&&$('detail').open)drawDetail();lockControls();
}
function openDetail(id){if(busy||!ready)return;selected=id;detailError='';drawDetail();$('detail').showModal();}
function drawDetail(){
 if(!ready){$('detail-body').replaceChildren(el('p',detailError||'보드를 다시 읽은 뒤 진행하세요.'));return;}
 const c=state.cases.find(x=>x.id===selected);if(!c){$('detail').close();selected=null;return;}
 $('detail-title').textContent=c.id+' · '+c.title;const body=$('detail-body');body.replaceChildren();
 const status=el('section',undefined,'detail-status');status.append(el('strong',c.phaseLabel),el('p',c.nextAction));body.append(status);
 if(c.checks.length){const list=el('ul',undefined,'check-list');for(const check of c.checks){const li=el('li');li.append(el('span',check.label),el('b',check.ok?'확인됨':'대기'));list.append(li);}body.append(list);}else body.append(el('p','이번 소개는 종료됐습니다. 누가 거절했는지와 사유는 표시하지 않습니다.'));
 if(c.introduced)body.append(el('p','합성 연결 확인 완료. 후속: '+(followups[c.followup]||'아직 기록 없음')));
 const actions=el('div',undefined,'detail-actions');
 for(const a of c.actions){
  if(a.type==='followup'){const label=el('label','만남 후속 상태'),select=el('select');select.id='followup';select.setAttribute('aria-label','만남 후속 상태');for(const [value,text]of Object.entries(followups))select.add(new Option(text,value));select.value=c.followup||'unknown';label.append(select);actions.append(label);}
  const b=el('button',a.label,['decline','withdraw'].includes(a.type)?'danger':['hold','resume'].includes(a.type)?'quiet':'');b.disabled=busy;b.onclick=()=>act({type:a.type,caseId:c.id,...(a.type==='followup'?{value:$('followup').value}:{})});actions.append(b);
 }
 body.append(actions,el('p','테스트 역할에서만 응답을 기록합니다. 실제 동의·연락 발송·만남을 수행하지 않습니다.','test-note'));
 const msg=el('p',detailError);msg.id='detail-message';msg.setAttribute('role','status');body.append(msg);
 const history=el('ul',undefined,'history');for(const e of c.events.slice(-7))history.append(el('li',new Date(e.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · '+e.label));body.append(history);
}
async function act(command){if(busy||!ready)return;busy=true;detailError='';lockControls();drawDetail();try{state=await api('/api/action',{...command,eventId:crypto.randomUUID(),version:state.version});$('message').textContent='합성 기록을 저장했습니다. 외부 연락은 발송하지 않았습니다.';render();}catch(e){detailError=e.message;$('message').textContent=e.message;await refresh();}finally{busy=false;lockControls();if(selected&&$('detail').open)drawDetail();render();}}
$('actor').onchange=async()=>{if(busy){$('actor').value=actor;return;}actor=$('actor').value;selected=null;$('detail').close();$('message').textContent='합성 테스트 역할을 바꿨습니다.';await refresh();};
$('filter').onchange=render;$('refresh').onclick=()=>{if(!busy)return refresh();};$('close-detail').onclick=()=>{$('detail').close();selected=null;};
$('new').onclick=()=>{if(busy||!ready)return;$('pair').replaceChildren();for(const p of state.pairs)$('pair').add(new Option(p.singles.join(' · '),p.id));$('create-message').textContent='';$('create').showModal();};
$('close-create').onclick=()=>$('create').close();
$('create-submit').onclick=async()=>{if(busy||!ready)return;busy=true;lockControls();try{state=await api('/api/action',{type:'create',pairId:$('pair').value,eventId:crypto.randomUUID(),version:state.version});$('create').close();$('message').textContent='합성 소개 건을 만들었습니다. 주선자 각각의 검토부터 시작하세요.';render();}catch(e){$('create-message').textContent=e.message;await refresh();}finally{busy=false;lockControls();render();}};
$('reset').onclick=async()=>{if(busy||!ready)return;busy=true;lockControls();try{state=await api('/api/reset',{});selected=null;$('detail').close();$('message').textContent='합성 초기 자료로 돌아왔습니다.';render();}catch(e){$('message').textContent=e.message;}finally{busy=false;lockControls();render();}};
await refresh();
