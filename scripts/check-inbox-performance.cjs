/* eslint-disable @typescript-eslint/no-require-imports -- synthetic SQL QA, no real database */
require('tsx/cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const originalResolve=Module._resolveFilename;
// Reuse the existing inbox fixture without requiring an extra copy of PGlite.
const pglite=require.resolve('@electric-sql/pglite');
Module._resolveFilename=function(name,...args){return name.includes('.testenv/test-runtime/node_modules/@electric-sql/pglite')||name.includes('.testenv\\test-runtime\\node_modules\\@electric-sql\\pglite')?pglite:originalResolve.call(this,name,...args)};
const {runCheck}=require('./check-inbox.cjs');
Module._resolveFilename=originalResolve;
runCheck(async({db,pg,actor,otherActor,channel,repo})=>{
 try {
  await pg.query(`INSERT INTO inbox_conversations(org_id,channel_id,token_hash,name,status,last_message_at)
   SELECT $1,$2,md5(i::text),'가상 상담 '||i,CASE WHEN i%2=0 THEN 'closed' ELSE 'open' END,now()-i*interval '1 second' FROM generate_series(1,20000) i`,[actor.orgId,channel.id]);
  const start=performance.now();
  const rows=await repo.listConversations(actor,channel.id,db,undefined,undefined,{status:'open'});
  const rowsMs=performance.now()-start;
  const countsStart=performance.now();
  const counts=await repo.conversationCounts(actor,channel.id,{status:'open'},db);
  const countsMs=performance.now()-countsStart;
  assert.equal(rows.length,100);assert.equal(counts.all,10000);
  const last=rows.at(-1);
  const next=await repo.listConversations(actor,channel.id,db,new Date(last.lastMessageAt),last.id,{status:'open'});
  assert.equal(next.length,100);assert.equal(new Set([...rows,...next].map(r=>r.id)).size,200);
  const legacy=await repo.conversationListPage(actor,channel.id,{status:'open'},undefined,undefined,db);
  assert.deepEqual(legacy.counts,counts);assert.deepEqual(legacy.rows,rows);
  await assert.rejects(repo.conversationCounts(otherActor,channel.id,{status:'open'},db));
  const search=await repo.conversationCounts(actor,channel.id,{status:'closed',q:'가상 상담 20000'},db);
  assert.equal(search.all,1);
  const result={synthetic:true,engine:'PGlite PostgreSQL WASM',conversations:20000,rowsMs,countsMs,firstPage:rows.length,secondPage:next.length,counts:counts.all,legacyCompatible:true,scopeDenied:true,searchPassed:true};
  const out=path.resolve(__dirname,'../docs/2026-10-23-inbox-performance/evidence/sql.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 } finally { await pg.close(); }
}).catch(e=>{console.error(e);process.exitCode=1});
