import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {openStore} from './store.mjs';import {snapshot,BoardError} from './core.mjs';
const base=path.dirname(fileURLToPath(import.meta.url));
export async function createServer({dataFile=path.join(base,'.data/board.local.json')}={}){
 const store=await openStore(dataFile);
 const app=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  try{
   const u=new URL(req.url,'http://127.0.0.1');
   if(u.pathname.startsWith('/api/')){
    const actor=req.headers['x-demo-actor'];
    if(req.method==='GET'&&u.pathname==='/api/state'){send(200,snapshot(store.read(),actor));return;}
    if(req.method!=='POST')throw new BoardError(405,'지원하지 않는 요청입니다.');
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new BoardError(403,'이 로컬 화면에서만 변경할 수 있습니다.');
    if(!String(req.headers['content-type']).startsWith('application/json'))throw new BoardError(415,'JSON 요청이 필요합니다.');
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw new BoardError(413,'요청이 너무 큽니다.');}
    let cmd;try{cmd=JSON.parse(body);}catch{throw new BoardError(400,'요청 형식이 올바르지 않습니다.');}
    let state;if(u.pathname==='/api/action')state=await store.dispatch(actor,cmd);else if(u.pathname==='/api/reset')state=await store.reset(actor);else throw new BoardError(404,'경로를 찾을 수 없습니다.');
    send(200,snapshot(state,actor));return;
   }
   const files={'/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/style.css':'style.css','/whytree-preview.html':'whytree-preview.html','/whytree.css':'whytree.css','/whytree-gyunggoo.pptx':'whytree-gyunggoo.pptx','/whytree-gyunggoo-review.pdf':'whytree-gyunggoo-review.pdf'};
   if(req.method!=='GET'||!files[u.pathname])throw new BoardError(404,'파일을 찾을 수 없습니다.');
   const name=files[u.pathname],content=await fs.readFile(path.join(base,name));
   const mime=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.pdf')?'application/pdf':name.endsWith('.pptx')?'application/vnd.openxmlformats-officedocument.presentationml.presentation':'text/javascript; charset=utf-8';
   res.writeHead(200,{'Content-Type':mime});res.end(content);
  }catch(e){send(e.status||500,{error:e.status?e.message:'로컬 저장/처리에 실패했습니다. 기존 상태는 유지됩니다.'});}
 });return app;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.argv[2]||8767);const app=await createServer();app.listen(port,'127.0.0.1',()=>console.log(`TTU synthetic prototype: http://127.0.0.1:${port}`));
}
