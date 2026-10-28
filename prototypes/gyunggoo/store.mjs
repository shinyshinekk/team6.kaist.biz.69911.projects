import fs from 'node:fs/promises';import path from 'node:path';
import {seed,assertState,reduce,BoardError} from './core.mjs';
export async function openStore(file){
 let state;
 try{state=assertState(JSON.parse(await fs.readFile(file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;state=seed();}
 let queue=Promise.resolve();
 async function save(next){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(next,null,2),'utf8');await fs.rename(tmp,file);state=next;}
 return {read:()=>structuredClone(state),
  dispatch(actor,cmd){const job=queue.then(async()=>{const next=reduce(state,actor,cmd);if(next!==state)await save(next);return structuredClone(state);});queue=job.catch(()=>{});return job;},
  reset(actor){const job=queue.then(async()=>{if(actor!=='M-A')throw new BoardError(403,'주선자 A의 합성 데모에서만 초기화할 수 있습니다.');await save({...seed(),version:state.version+1});return structuredClone(state);});queue=job.catch(()=>{});return job;}
 };
}
