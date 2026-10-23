/* eslint-disable @typescript-eslint/no-require-imports -- isolated synthetic browser fixture */
// Real InboxPage + hooks, including the production React compiler. No credentials or external sends.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const babelDir = fs.readdirSync(path.join(root, 'node_modules/.pnpm')).find(p => p.startsWith('@babel+core@'));
const babel = require(path.join(root, 'node_modules/.pnpm', babelDir, 'node_modules/@babel/core'));
const compiler = require('babel-plugin-react-compiler');
const {execFileSync}=require('node:child_process');
const baseline=process.env.INBOX_QA_BASELINE;
const baselineSources=new Map();
if(baseline){
 if(!/^[a-f0-9]{7,40}$/.test(baseline))throw new Error('Use an explicit commit SHA');
 for(const file of ['src/components/inbox/ui/ConversationPane.tsx','src/components/inbox/ui/InboxPage.tsx','src/components/inbox/hooks/useInbox.ts','src/components/inbox/api/index.ts'])
  baselineSources.set(path.join(root,file),execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8'}));
}

const port = Number(process.env.INBOX_QA_PORT || 3121);
const evidence = { baseline, synthetic: true, reactCompiler: true, metric: 'input capture through React Profiler commit (not animation-frame delay)', requests: [], measurements: [], sends: [] };
const now = '2026-10-22T09:00:00.000Z';
const chats = Array.from({length: 220}, (_,i) => ({id:`qa-${i+1}`,channelId:1,name:`가상고객 ${i+1}`,email:null,pageUrl:null,status:i>=200?'closed':'open',assigneeId:null,recordId:null,contactId:null,tags:[],priority:i%2===0,preview:'가상 문의입니다',lastMessageAt:new Date(Date.parse(now)-i*60000).toISOString(),customerSeq:100,replyRevision:100,unread:true,version:1,aiState:'human',aiHandoffReason:null,medium:'web'}));
const messages = new Map(chats.map(c=>[c.id, Array.from({length:100},(_,i)=>({id:i+1,clientId:`${c.id}-${i}`,kind:i%2?'reply':'customer',body:`${c.name} · 이전 메시지 ${i+1} · 실제 고객과 무관한 검수 자료입니다.`,authorName:i%2?'가상 담당자':c.name,createdAt:new Date(Date.parse(now)+i*1000).toISOString(),attachments:[]}))]));
const sentAt = new Map();
const lostOnce = new Set();
async function main() {
 const bundle=await esbuild.build({absWorkingDir:root,bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react'; import {createRoot} from 'react-dom/client'; import {SWRConfig} from 'swr'; import {Toaster} from 'sonner';
 import {InboxPage} from './src/components/inbox/ui/InboxPage';
 let formats=0; for(const k of ['toLocaleDateString','toLocaleTimeString','toLocaleString']){ const old=Date.prototype[k]; Date.prototype[k]=function(...a){formats++;return old.apply(this,a)}; }
 const pending=[]; let activeInput=null;
 document.addEventListener('input', e=>{activeInput={start:performance.now(),count:formats,field:e.target.getAttribute('aria-label')};},true);
 const rendered=(id,phase,actualDuration)=>{if(!activeInput)return; const x=activeInput;activeInput=null;pending.push({type:'input',field:x.field,commitMs:performance.now()-x.start,renderMs:actualDuration,dateFormats:formats-x.count,visibility:document.visibilityState});document.getElementById('qa-stats').textContent=JSON.stringify(pending.slice(-5));};
 document.addEventListener('click',e=>{const label=e.target.closest('button')?.getAttribute('aria-label');if(label?.includes('상담 열기'))pending.push({type:'switch',label,at:performance.now()});},true);
 document.getElementById('qa-save').onclick=()=>fetch('/__qa/measurements',{method:'POST',body:JSON.stringify(pending)});
 createRoot(document.getElementById('app')).render(<React.Profiler id="inbox" onRender={rendered}><SWRConfig value={{provider:()=>new Map(),shouldRetryOnError:false}}><InboxPage userId="qa-user" orgId="qa-org" role="admin"/><Toaster/></SWRConfig></React.Profiler>);
 `},plugins:[{name:'production-react-compiler',setup(build){
  build.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
  build.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({resolveDir:root,loader:'jsx',contents:name==='navigation'?`export function useSearchParams(){return new URLSearchParams(location.search)}; export function useRouter(){return {push:()=>{},replace:()=>{}}}`:`export default function Link(p){return <a {...p}/>}`}));
  build.onLoad({filter:/\.(tsx|ts)$/},async({path:file})=>{if(!file.includes(path.sep+'src'+path.sep))return; const result=await babel.transformAsync((baselineSources.get(file)||fs.readFileSync(file,'utf8')),{filename:file,configFile:false,babelrc:false,parserOpts:{plugins:['typescript','jsx']},plugins:[[compiler,{target:'19'}]]});return {contents:result.code,loader:file.endsWith('tsx')?'tsx':'ts'};});
 }}]});
 const cssDir=process.env.INBOX_QA_CSS_DIR||path.join(root,'.next/static/css');
 const css=fs.existsSync(cssDir)?fs.readdirSync(cssDir).filter(p=>p.endsWith('.css')).map(p=>fs.readFileSync(path.join(cssDir,p),'utf8')).join('\n'):'';
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  const json=(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))};
  if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(bundle.outputFiles[0].contents)}
  if(url.pathname==='/style.css'){res.setHeader('content-type','text/css');return res.end(css)}
  if(url.pathname==='/__qa/measurements'){evidence.measurements=body;return json({saved:true})}
  if(url.pathname==='/__qa/report')return json(evidence);
  if(!url.pathname.startsWith('/api/')){res.setHeader('content-type','text/html;charset=utf-8');return res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>상담 성능 · 가상 자료 검수</title><link rel="stylesheet" href="/style.css"><style>body{font-family:Arial,sans-serif}#app{height:90vh}#qa-stats{font-size:11px;max-height:50px;overflow:auto}</style><header>격리 검수 · 실제 상담 UI · React compiler ON · 집계 3초/전송 후 재조회 2.5초 지연 주입 <button id="qa-save">측정 저장</button><pre id="qa-stats"></pre></header><div id="app"></div><script src="/bundle.js"></script></html>`)}
  const entry={method:req.method,url:url.pathname+url.search,at:Date.now()};evidence.requests.push(entry);
  const reply=async(data,delay=30)=>{await new Promise(r=>setTimeout(r,delay));entry.ms=Date.now()-entry.at;json({success:true,data})};
  if(url.pathname==='/api/inbox'&&!url.searchParams.has('channelId'))return reply({channels:[{id:1,workspaceId:1,name:'가상 사업',enabled:true,replyGuardEnabled:false}],members:[{id:'qa-user',name:'가상 담당자',workspaceIds:[1]}],workspaces:[{id:1,name:'가상 사업',role:'agent',abilities:{read:true,respond:true,manage:false}}],teams:[],canManageAccess:false});
  if(url.pathname==='/api/inbox'){
   let rows=chats.filter(c=>c.status===url.searchParams.get('status'));
   if(url.searchParams.get('filter')==='priority')rows=rows.filter(c=>c.priority);
   if(url.searchParams.get('q'))rows=rows.filter(c=>c.name.includes(url.searchParams.get('q')));
   const counts={all:rows.length,unread:rows.filter(c=>c.unread).length,mine:0,unassigned:rows.length,priority:rows.filter(c=>c.priority).length,myTeams:0,history:0,mentioned:0};
   const before=url.searchParams.get('beforeId');if(before)rows=rows.slice(rows.findIndex(c=>c.id===before)+1);rows=rows.slice(0,100);
   const view=url.searchParams.get('view');return reply(view==='counts'?counts:{rows,counts,hasMore:rows.length===100},view==='list'||view==='counts'?3000:30);
  }
  if(url.pathname==='/api/inbox-presence')return reply({agents:[],me:{state:'available',version:1},serverTime:now});
  if(url.pathname==='/api/inbox-reply-guard')return reply({enabled:false,conversation:{revision:100,lease:null}});
  if(url.pathname==='/api/inbox-notifications')return reply({rows:[],unread:0,hasMore:false});
  if(url.pathname.startsWith('/api/inbox-operations/conversations/'))return reply({cases:[],historyOnly:false});
  const match=url.pathname.match(/^\/api\/inbox\/conversations\/([^/]+)(.*)$/);
  if(match){const [,id,suffix]=match,chat=chats.find(c=>c.id===id);if(!chat)return json({success:false,error:'missing synthetic chat'},404);
   if(suffix==='/journey')return reply({status:'unlinked',events:[]});
   if(suffix==='/reply-contact')return reply(null);
   if(suffix==='/audit')return reply({rows:[],hasMore:false});
   if(suffix)return json({success:false,error:'Unmocked path: '+suffix},500);
   if(req.method==='POST'&&body.action==='read'){chat.unread=false;return reply({read:true})}
   if(req.method==='POST'){let message=messages.get(id).find(m=>m.clientId===body.clientId);if(!message){message={id:messages.get(id).length+1,clientId:body.clientId,kind:body.kind,body:body.body,authorName:'가상 담당자',createdAt:new Date().toISOString(),attachments:[]};messages.get(id).push(message);chat.replyRevision++;sentAt.set(id,Date.now());evidence.sends.push({id,clientId:body.clientId,body:body.body});}const scenario=new URL(req.headers.referer||'http://127.0.0.1').searchParams.get('send');
    if(scenario==='lost'&&!lostOnce.has(body.clientId)){lostOnce.add(body.clientId);const timer=setTimeout(()=>reply(message,0),25000);res.on('close',()=>clearTimeout(timer));return;}
    return reply(message,80)}
   if(new URL(req.headers.referer||'http://127.0.0.1').searchParams.get('detail')==='fail'&&sentAt.has(id))return json({success:false,error:'가상 상세 조회 지연'},503);
   const result={conversation:{...chat},messages:[...messages.get(id)],hasOlder:false};return reply(result,Date.now()-(sentAt.get(id)||0)<5000?2500:30);
  }
  return json({success:false,error:'Unmocked API: '+url.pathname},500);
 });server.listen(port,'127.0.0.1',()=>console.log(`Synthetic inbox QA http://127.0.0.1:${port}`));
}
main().catch(e=>{console.error(e);process.exitCode=1});
