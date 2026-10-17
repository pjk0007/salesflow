/* eslint-disable @typescript-eslint/no-require-imports -- 격리 PostgreSQL의 허구 상담 집계·이전 원자성 검사 */
const assert=require('node:assert/strict');
const {runPostgresPlatformCheck}=require('./customer-platform-test-postgres.cjs');
runPostgresPlatformCheck(async ctx=>{
    const s=require('../src/lib/db/schema.ts'),{eq,and,sql}=require('drizzle-orm');
    const {channelFixture,AT}=require('./fixtures/customer-import-history-fictional.cjs');
    const bundle=channelFixture({conversations:3,messages:301}).bundle;
    for(const user of bundle.users){user.member=false;user.type='lead';delete user.memberId;}
    const wanted=new Set(['history-a-000','history-a-001','history-a-002','note-only']);
    bundle.userChats=bundle.userChats.filter(c=>wanted.has(c.id));
    bundle.messages=bundle.messages.filter(m=>wanted.has(m.chatId));
    const namespace='fictional-message-batch',client=ctx.clients.dh;
    const input=content=>({workspaceId:8,source:'channel',namespace,format:'json',content:JSON.stringify(content)});
    const start=async content=>{let job=await client.previewImport(input(content));assert.deepEqual(job.errors,[]);return client.changeImport(job.id,{action:'start',version:job.version,fingerprint:job.fingerprint,acknowledge:true});};
    const aggregate=async()=>{
        const chats=await ctx.db.select().from(s.inboxConversations).where(eq(s.inboxConversations.channelId,ctx.channels.dh.id));
        let checked=0;
        for(const chat of chats.filter(c=>c.importMetadata?.namespace===namespace)){
            const rows=await ctx.db.select().from(s.inboxMessages).where(eq(s.inboxMessages.conversationId,chat.id));
            const publicRows=rows.filter(m=>m.kind!=='note').sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)||b.id-a.id);
            assert.equal(chat.preview,publicRows[0]?.body.slice(0,200)||'');
            assert.equal(+new Date(chat.lastMessageAt),+new Date(publicRows[0]?.createdAt??chat.createdAt));
            assert.equal(chat.customerSeq,rows.filter(m=>m.kind==='customer').length);
            checked++;
        }
        return checked;
    };
    let job=await start(bundle),steps=0;
    while(job.state==='running'&&steps++<10){job=await client.stepImport(job.id,job.cursor,250);assert.notEqual(job.state,'failed',job.reason);await aggregate();}
    assert.equal(job.state,'completed');assert.equal(steps,2);assert.equal(await aggregate(),4);
    const completedPlan=await require('../src/lib/customer-imports/repository.ts').importOwned(ctx.actor,job.id,ctx.db);
    const messageKeys=await ctx.db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.namespace,namespace),eq(s.customerImportObjects.kind,'messages')));
    const messageIds=new Map(messageKeys.map(k=>[k.sourceId,Number(k.targetId)]));
    const orderedIds=completedPlan.plan.filter(r=>r.kind==='messages').map(r=>messageIds.get(r.sourceId));
    for(let i=1;i<orderedIds.length;i++)assert(orderedIds[i]>orderedIds[i-1],'원본 계획 순서의 메시지 ID가 뒤바뀌었습니다.');
    const noteChat=(await ctx.db.select().from(s.inboxConversations).where(eq(s.inboxConversations.channelId,ctx.channels.dh.id))).find(c=>c.importMetadata?.namespace===namespace&&c.importMetadata.sourceId==='note-only');
    assert(noteChat);assert.equal(noteChat.preview,'');assert.equal(noteChat.customerSeq,0);assert.equal(+new Date(noteChat.lastMessageAt),+new Date(noteChat.createdAt));
    const beforeCount=(await ctx.db.select({n:sql`count(*)`.mapWith(Number)}).from(s.inboxMessages))[0].n;
    const extra=structuredClone(bundle);
    extra.messages.unshift(...Array.from({length:20},(_,i)=>({id:'rollback-'+i,chatId:'history-a-000',personType:'user',personId:'source-a',plainText:'허구 롤백 검수 '+i,createdAt:Date.parse(AT)-1000000+i})));
    let rollback=await start(extra);
    const full=await require('../src/lib/customer-imports/repository.ts').importOwned(ctx.actor,rollback.id,ctx.db);
    const changed=full.plan.find(r=>r.kind==='messages'&&r.operation==='reuse');assert(changed);assert(changed.index<250);
    await ctx.db.update(s.inboxMessages).set({body:'허구 직원이 실행 직전에 편집'}).where(eq(s.inboxMessages.id,Number(changed.targetId)));
    const statsBefore=await ctx.db.select({id:s.inboxConversations.id,preview:s.inboxConversations.preview,lastMessageAt:s.inboxConversations.lastMessageAt,customerSeq:s.inboxConversations.customerSeq}).from(s.inboxConversations).where(eq(s.inboxConversations.channelId,ctx.channels.dh.id));
    rollback=await client.stepImport(rollback.id,0,250);assert.equal(rollback.state,'failed');assert.equal(rollback.cursor,0);
    assert.equal((await ctx.db.select({n:sql`count(*)`.mapWith(Number)}).from(s.inboxMessages))[0].n,beforeCount);
    assert.equal((await ctx.db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.namespace,namespace),sql`${s.customerImportObjects.sourceId} like '%rollback-%'`))).length,0);
    assert.deepEqual(await ctx.db.select({id:s.inboxConversations.id,preview:s.inboxConversations.preview,lastMessageAt:s.inboxConversations.lastMessageAt,customerSeq:s.inboxConversations.customerSeq}).from(s.inboxConversations).where(eq(s.inboxConversations.channelId,ctx.channels.dh.id)),statsBefore);
    const manual=(await ctx.db.select().from(s.inboxMessages).where(eq(s.inboxMessages.id,Number(changed.targetId))))[0];assert.equal(manual.body,'허구 직원이 실행 직전에 편집');
    await ctx.db.update(s.inboxMessages).set({body:String(changed.data.body)}).where(eq(s.inboxMessages.id,Number(changed.targetId)));
    const parallelConflict=await start(extra);
    const conflictSource='history-a-000/rollback-10';
    await ctx.db.insert(s.customerImportObjects).values({orgId:ctx.actor.orgId,workspaceId:8,source:'channel',namespace,kind:'messages',sourceId:conflictSource,targetId:changed.targetId,sourceFingerprint:'f'.repeat(64),targetFingerprint:'f'.repeat(64),owned:false,jobId:parallelConflict.id});
    const failedParallel=await client.stepImport(parallelConflict.id,0,250);
    assert.equal(failedParallel.state,'failed');assert.equal(failedParallel.cursor,0);
    assert.equal((await ctx.db.select({n:sql`count(*)`.mapWith(Number)}).from(s.inboxMessages))[0].n,beforeCount);
    const afterKeys=await ctx.db.select().from(s.customerImportObjects).where(and(eq(s.customerImportObjects.namespace,namespace),sql`${s.customerImportObjects.sourceId} like '%rollback-%'`));
    assert.equal(afterKeys.length,1);assert.equal(afterKeys[0].sourceId,conflictSource);assert.equal(afterKeys[0].owned,false);
    assert.equal((await ctx.db.select().from(s.customerImportResults).where(eq(s.customerImportResults.jobId,parallelConflict.id))).length,0);
    for(const table of [s.customerAiJobs,s.customerWorkflowRuns,s.platformWebhookDeliveries])assert.equal((await ctx.db.select({n:sql`count(*)`.mapWith(Number)}).from(table))[0].n,0);
    console.log('PASS 묶음별 상담 집계: 301개 시간 역순·동시각 메시지·원본 ID 순서·250행 경계·다중 상담·메모만 있는 상담·병렬 내부 충돌의 전체 롤백·직원 수정 보존·외부 발송 없음');
}).catch(error=>{console.error(error);process.exitCode=1;});
