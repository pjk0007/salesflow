/* eslint-disable @typescript-eslint/no-require-imports -- 고객 문의 목록/새 문의/읽음의 격리 SQL·API·SDK 검수 */
const assert=require("node:assert/strict"),{randomUUID}=require("node:crypto");
const {runPlatformCheck}=require("./check-customer-platform.cjs");
async function scenario(ctx){
 const {db,pg,actor,channels,clients,contacts,repo,dispatch}=ctx,s=require("../src/lib/db/schema.ts"),{eq,sql}=require("drizzle-orm"),
 {SendbMessengerClient}=require("../sdk/messenger.ts"),{linkVisitorIdentity}=require("../src/lib/inbox/link-identity.ts");
 const identity=(await clients.dh.customerIdentity(channels.dh.id,contacts.dh.id)).identityToken,
 messenger=new SendbMessengerClient({apiBase:"http://127.0.0.1:3120",channelKey:channels.dh.publicKey,getToken:()=>identity,fetchImpl:dispatch});
 const raw=(path,method="GET",body,token=identity)=>dispatch(`http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const count=async t=>(await db.select({n:sql`count(*)`.mapWith(Number)}).from(t))[0].n;
 const send=(id,body)=>messenger.sendMessage(id,{clientId:randomUUID(),body});
 let n=0,a,b,first;
 const check=async(name,fn)=>{await fn();console.log(`PASS CUSTOMER HISTORY ${++n} ${name}`);};
 await check("조회만으로 빈 문의를 만들지 않고 현재 웹 문의만 공개 목록에 표시",async()=>{const before=await count(s.inboxConversations);await require("../src/lib/inbox-customer-history/repository.ts").customerConversationPage(channels.dh.publicKey,identity,undefined,db);const page=await messenger.conversations();first=(await messenger.conversation()).conversationId;assert.equal(page.rows.length,1);assert.equal(page.rows[0].id,first);assert.equal(await count(s.inboxConversations),before);});
 const initial={clientId:randomUUID(),body:"첫 번째 별도 문의입니다."};
 await check("새 문의는 첫 메시지와 원자적으로 생성하고 기존 문의·담당·상태를 보존",async()=>{const old=(await repo.conversationDetail(actor,first,db)).conversation;a=await messenger.createConversation(initial);assert.notEqual(a.conversationId,first);assert.equal((await messenger.conversation()).conversationId,a.conversationId);const detail=(await repo.conversationDetail(actor,first,db)).conversation;assert.equal(detail.status,old.status);assert.equal(detail.assigneeId,old.assigneeId);assert.equal((await messenger.conversations()).rows.length,2);});
 await check("새 문의 같은 요청 재시도는 같은 문의·메시지, 내용 변경은 409",async()=>{const before=await count(s.inboxConversations);assert.deepEqual(await messenger.createConversation(initial),a);await assert.rejects(messenger.createConversation({...initial,body:"다른 문장"}),e=>e.status===409);assert.equal(await count(s.inboxConversations),before);});
 await check("기존 문의에 선택 답변해도 현재 문의의 기본 연결은 바뀌지 않음",async()=>{await send(first,"예전 문의에 추가 질문");assert.equal((await messenger.conversation()).conversationId,a.conversationId);assert.ok((await messenger.conversation(first)).messages.some(m=>m.body==="예전 문의에 추가 질문"));});
 await check("다른 회원·사업·잘못된 선택은 읽기·보내기·파일·읽음에서 차단",async()=>{const other=await clients.dh.upsertContact({workspaceId:8,externalId:"history-other",name:"가상 다른 회원"}),token=(await clients.dh.customerIdentity(channels.dh.id,other.id)).identityToken;assert.equal((await raw(`?conversationId=${first}`,"GET",undefined,token)).status,404);assert.equal((await raw(`?conversationId=${first}`,"POST",{clientId:randomUUID(),body:"금지"},token)).status,404);assert.equal((await raw(`/conversations/${first}/read`,"POST",{lastMessageId:a.id},token)).status,404);assert.equal((await raw("?conversationId=bad")).status,400);const foreign=(await clients.bo.customerIdentity(channels.bo.id,contacts.bo.id)).identityToken;assert.equal((await raw("/conversations","GET",undefined,foreign)).status,401);});
 await check("비회원 증명은 자기 상담만 선택하고 전체 회원 목록/새 문의를 열 수 없음",async()=>{const anon=await repo.startVisitorSession(channels.dh.publicKey,{name:"가상 비회원"},db);await repo.sendVisitorMessage(channels.dh.publicKey,anon.token,{clientId:randomUUID(),body:"비회원 문의"},db);assert.equal((await raw(`/conversations`,"GET",undefined,anon.token)).status,401);assert.equal((await raw("/conversations","POST",{clientId:randomUUID(),body:"새 문의"},anon.token)).status,401);assert.equal((await raw(`?conversationId=${anon.id}`,"GET",undefined,anon.token)).status,200);assert.equal((await raw(`?conversationId=${first}`,"GET",undefined,anon.token)).status,404);});
 await check("직원 메모·메모 첨부·직원 ID·CRM 연결은 고객 목록/본문에 노출하지 않음",async()=>{await repo.sendAgentMessage(actor,a.conversationId,{clientId:randomUUID(),kind:"note",body:"PRIVATE HISTORY NOTE"},db);const text=JSON.stringify(await messenger.conversations())+JSON.stringify(await messenger.conversation(a.conversationId));assert.ok(!text.includes("PRIVATE HISTORY NOTE"));assert.ok(!text.includes("authorId"));assert.ok(!text.includes("recordId"));});
 await check("고객의 읽음은 문의별·서버에 저장되어 기기 변경에도 유지",async()=>{await repo.sendAgentMessage(actor,a.conversationId,{clientId:randomUUID(),kind:"reply",body:"첫 문의 답변"},db);const detail=await messenger.conversation(a.conversationId),last=detail.messages.at(-1).id;assert.ok((await messenger.conversations()).rows.find(r=>r.id===a.conversationId).unread>=1);await messenger.markRead(a.conversationId,last);const anotherDevice=new SendbMessengerClient({apiBase:"http://127.0.0.1:3120",channelKey:channels.dh.publicKey,getToken:()=>identity,fetchImpl:dispatch});assert.equal((await anotherDevice.conversations()).rows.find(r=>r.id===a.conversationId).unread,0);});
 await check("늦은 읽음 요청은 최신 읽음 위치를 되돌리지 않음·다른 문의/메모 ID 거절",async()=>{const detail=await messenger.conversation(a.conversationId),last=detail.messages.at(-1).id;await messenger.markRead(a.conversationId,a.id);assert.equal((await messenger.markRead(a.conversationId,last)).lastMessageId,last);const note=(await db.select().from(s.inboxMessages).where(eq(s.inboxMessages.kind,"note"))).find(m=>m.conversationId===a.conversationId);await assert.rejects(messenger.markRead(a.conversationId,note.id),e=>e.status===409);await assert.rejects(messenger.markRead(first,a.id),e=>e.status===409);});
 await check("종료 문의에 다시 보내면 해당 문의만 재개하고 다른 문의를 만들지 않음",async()=>{const old=(await repo.conversationDetail(actor,first,db)).conversation;await repo.patchConversation(actor,first,{status:"closed",version:old.version},db);const before=await count(s.inboxConversations);await send(first,"이 문의에 다시 질문합니다");assert.equal((await messenger.conversation(first)).status,"open");assert.equal(await count(s.inboxConversations),before);});
 await check("새 문의 첨부는 기존 문의에 묶지 않고 새 문의와 함께 저장/다운로드",async()=>{const bytes=Buffer.from("%PDF-1.4 fictional customer file"),file=await messenger.upload(new Blob([bytes]),"new.pdf",randomUUID(),{newConversation:true});b=await messenger.createConversation({clientId:randomUUID(),body:"새 첨부 문의",attachmentIds:[file.id]});assert.deepEqual(Buffer.from((await messenger.download(file.id,b.conversationId)).bytes),bytes);await assert.rejects(messenger.download(file.id,first),e=>e.status===404);});
 await check("유효하지 않은 첨부로 새 문의 실패 시 기존 기본 문의·outbox까지 롤백",async()=>{const before=await count(s.inboxConversations),current=(await messenger.conversation()).conversationId;await assert.rejects(messenger.createConversation({clientId:randomUUID(),body:"실패해야 함",attachmentIds:[randomUUID()]}),e=>[404,409].includes(e.status));assert.equal(await count(s.inboxConversations),before);assert.equal((await messenger.conversation()).conversationId,current);});
 await check("새 문의 이후 과거 생성 요청 재시도는 현재 문의를 바꾸지 않음",async()=>{assert.deepEqual(await messenger.createConversation(initial),a);assert.equal((await messenger.conversation()).conversationId,b.conversationId);});
 await check("과거 서비스 기록·이메일 상담은 고객 웹 문의 목록/선택/읽음에서 제외",async()=>{const [historic]=await db.insert(s.inboxConversations).values({orgId:actor.orgId,channelId:channels.dh.id,contactId:contacts.dh.id,name:"가상 가져온 기록",tokenHash:"a".repeat(64),historyOnly:true}).returning();const [email]=await db.insert(s.inboxConversations).values({orgId:actor.orgId,channelId:channels.dh.id,contactId:contacts.dh.id,name:"가상 이메일",tokenHash:"b".repeat(64),medium:"email"}).returning();for(const c of [historic,email]){await db.insert(s.inboxMessages).values({conversationId:c.id,clientId:randomUUID(),kind:"customer",body:"PRIVATE SOURCE HISTORY",authorName:"가상 고객"});await assert.rejects(messenger.conversation(c.id),e=>e.status===404);}assert.ok(!JSON.stringify(await messenger.conversations()).includes("PRIVATE SOURCE HISTORY"));});
 await check("비회원 로그인 연결은 최신 기본 문의로 합치고 과거 별도 문의는 보존",async()=>{const anon=await repo.startVisitorSession(channels.dh.publicKey,{name:"가상 로그인 전"},db);await repo.sendVisitorMessage(channels.dh.publicKey,anon.token,{clientId:randomUUID(),body:"로그인 직전 문의"},db);const linked=await linkVisitorIdentity(channels.dh.publicKey,identity,{action:"identify",anonymousToken:anon.token},db);assert.equal(linked.id,b.conversationId);assert.ok((await messenger.conversation(b.conversationId)).messages.some(m=>m.body==="로그인 직전 문의"));assert.ok((await messenger.conversation(a.conversationId)).messages.some(m=>m.body===initial.body));});
 await check("50개 커서·전체 문의의 미확인 답변 수·제목은 메모와 분리",async()=>{const extra=await db.insert(s.inboxConversations).values(Array.from({length:51},(_,i)=>({orgId:actor.orgId,channelId:channels.dh.id,contactId:contacts.dh.id,name:"가상 페이지 "+i,tokenHash:randomUUID().replaceAll("-","").repeat(2),isCurrent:false,lastMessageAt:new Date("2020-01-01")}))).returning();await db.insert(s.inboxMessages).values(extra.flatMap((c,i)=>[{conversationId:c.id,clientId:randomUUID(),kind:"customer",body:"가상 제목 "+i,authorName:"가상 고객"},{conversationId:c.id,clientId:randomUUID(),kind:"reply",body:"가상 공개 답변 "+i,authorName:"가상 상담원"},{conversationId:c.id,clientId:randomUUID(),kind:"note",body:"PRIVATE PAGE NOTE",authorName:"가상 상담원"}]));const page=await messenger.conversations(),next=await messenger.conversations(page.nextBefore);assert.equal(page.rows.length,50);assert.equal(page.hasMore,true);assert.ok(next.rows.length>0);assert.equal(new Set([...page.rows,...next.rows].map(r=>r.id)).size,page.rows.length+next.rows.length);assert.ok(page.unreadCount>=51);assert.ok(!JSON.stringify(page).includes("PRIVATE PAGE NOTE"));});
 const customer=async(business="dh")=>{
  const c=await clients[business].upsertContact({workspaceId:business==="dh"?8:10,externalId:"history-isolated-"+randomUUID(),name:"가상 문의 검수 회원"});
  const token=(await clients[business].customerIdentity(channels[business].id,c.id)).identityToken;
  return {contact:c,token,key:channels[business].publicKey,client:new SendbMessengerClient({apiBase:"http://127.0.0.1:3120",channelKey:channels[business].publicKey,getToken:()=>token,fetchImpl:dispatch})};
 };
 await check("동시에 재시도한 새 문의는 한 문의·한 메시지·한 생성 이벤트만 저장",async()=>{
  const c=await customer(),input={clientId:randomUUID(),body:"동시 재시도 검수"},result=await Promise.all(Array.from({length:6},()=>c.client.createConversation(input)));
  for(const r of result)assert.deepEqual(r,result[0]);
  const page=await c.client.conversations();assert.equal(page.rows.length,1);
  assert.equal((await c.client.conversation(result[0].conversationId)).messages.length,1);
  const events=await db.select().from(s.platformEvents).where(eq(s.platformEvents.eventKey,`conversation:${result[0].conversationId}:created`));assert.equal(events.length,1);
 });
 await check("동시 서로 다른 새 문의는 모두 보존하고 기본 문의는 하나만 선택",async()=>{
  const c=await customer(),result=await Promise.all(Array.from({length:4},(_,i)=>c.client.createConversation({clientId:randomUUID(),body:"동시 별도 문의 "+i})));
  const page=await c.client.conversations();assert.equal(page.rows.length,4);assert.equal(new Set(result.map(r=>r.conversationId)).size,4);assert.equal(page.rows.filter(r=>r.isCurrent).length,1);
  assert.ok(result.some(r=>r.conversationId===(page.rows.find(r=>r.isCurrent)).id));
 });
 await check("두 사업에서 문의 생성·선택·첨부·읽음 계약이 동일하며 고객 이력을 섞지 않음",async()=>{
  const c=await customer("bo"),file=await c.client.upload(new Blob(["fictional bo file"]),"bo.txt",randomUUID(),{newConversation:true}),a=await c.client.createConversation({clientId:randomUUID(),body:"백오피스랩 문의",attachmentIds:[file.id]}),b=await c.client.createConversation({clientId:randomUUID(),body:"백오피스랩 다른 문의"});
  await c.client.sendMessage(a.conversationId,{clientId:randomUUID(),body:"백오피스랩 예전 문의 추가"});assert.equal((await c.client.conversation()).conversationId,b.conversationId);
  await repo.sendAgentMessage(actor,a.conversationId,{clientId:randomUUID(),kind:"reply",body:"백오피스랩 답변"},db);
  const detail=await c.client.conversation(a.conversationId),read=await c.client.markRead(a.conversationId,detail.messages.at(-1).id,detail.readRevision);assert.equal(read.unread,0);assert.equal(read.readRevision,0);
  assert.equal((await c.client.conversations()).rows.length,2);assert.equal(Buffer.from((await c.client.download(file.id,a.conversationId)).bytes).toString(),"fictional bo file");
  await assert.rejects(messenger.conversation(a.conversationId),e=>e.status===404);await assert.rejects(c.client.conversation(first),e=>e.status===404);await assert.rejects(c.client.download(file.id,first),e=>e.status===404);
 });
 await check("다른 회원의 새 문의 초안 첨부·예전 문의에 묶인 첨부는 새 문의에 재사용 불가",async()=>{
  const owner=await customer(),foreign=await customer(),file=await owner.client.upload(new Blob(["fictional ownership file"]),"owner.txt",randomUUID(),{newConversation:true});
  const before=await count(s.inboxConversations),events=await count(s.platformEvents),messages=await count(s.inboxMessages);
  await assert.rejects(foreign.client.createConversation({clientId:randomUUID(),body:"다른 회원 파일",attachmentIds:[file.id]}),e=>e.status===409);
  assert.equal(await count(s.inboxConversations),before);assert.equal(await count(s.platformEvents),events);assert.equal(await count(s.inboxMessages),messages);
  const original=await owner.client.createConversation({clientId:randomUUID(),body:"첨부 원본 문의",attachmentIds:[file.id]});
  const tied=await owner.client.upload(new Blob(["fictional conversation-bound draft"]),"tied.txt",randomUUID(),{conversationId:original.conversationId});
  await assert.rejects(owner.client.createConversation({clientId:randomUUID(),body:"기존 문의에 묶인 파일",attachmentIds:[tied.id]}),e=>e.status===409);
  const [draft]=await db.select().from(s.inboxAttachments).where(eq(s.inboxAttachments.id,tied.id));assert.equal(draft.messageId,null);assert.equal(draft.draftConversationId,original.conversationId);assert.equal((await owner.client.conversations()).rows.length,1);
 });
 await check("낮은 ID의 병합 답변만 미확인으로 추가하고 기존 읽음·늦은 ACK·병합 재시도 보존",async()=>{
  const c=await customer(),current=await c.client.createConversation({clientId:randomUUID(),body:"회원 현재 문의"}),anon=await repo.startVisitorSession(c.key,{name:"가상 병합 이전 고객"},db);
  await repo.sendVisitorMessage(c.key,anon.token,{clientId:randomUUID(),body:"비회원 질문"},db);
  const moved=await repo.sendAgentMessage(actor,anon.id,{clientId:randomUUID(),kind:"reply",body:"병합할 낮은 번호 답변"},db);
  await repo.sendAgentMessage(actor,current.conversationId,{clientId:randomUUID(),kind:"reply",body:"이미 확인한 높은 번호 답변"},db);
  const old=await c.client.conversation(current.conversationId),high=old.messages.at(-1).id;assert.ok(moved.id<high);assert.equal((await c.client.markRead(current.conversationId,high,old.readRevision)).unread,0);
  await linkVisitorIdentity(c.key,c.token,{action:"identify",anonymousToken:anon.token},db);
  assert.equal((await c.client.conversations()).unreadCount,1);
  assert.equal((await c.client.markRead(current.conversationId,high,old.readRevision)).unread,1);assert.equal((await c.client.markRead(current.conversationId,high)).unread,1);
  const fresh=await c.client.conversation(current.conversationId);assert.equal(fresh.readRevision,old.readRevision+1);assert.ok(fresh.messages.some(m=>m.id===moved.id));
  const ack=await c.client.markRead(current.conversationId,high,fresh.readRevision);assert.equal(ack.unread,0);assert.equal(ack.readRevision,fresh.readRevision);
  await linkVisitorIdentity(c.key,c.token,{action:"identify",anonymousToken:anon.token},db);assert.equal((await c.client.conversation(current.conversationId)).readRevision,fresh.readRevision);assert.equal((await c.client.conversations()).unreadCount,0);
 });
 await check("첫 읽음 전 병합도 구형 ACK가 답변을 숨기지 않고 최신 문맥 ACK로만 확인",async()=>{
  const c=await customer(),anon=await repo.startVisitorSession(c.key,{name:"가상 첫 읽음 전"},db);await repo.sendVisitorMessage(c.key,anon.token,{clientId:randomUUID(),body:"낮은 ID 질문"},db);
  await repo.sendAgentMessage(actor,anon.id,{clientId:randomUUID(),kind:"reply",body:"낮은 ID 답변"},db);
  const current=await c.client.createConversation({clientId:randomUUID(),body:"첫 읽음 없는 현재 문의"});await repo.sendAgentMessage(actor,current.conversationId,{clientId:randomUUID(),kind:"reply",body:"높은 ID 답변"},db);
  const old=await c.client.conversation(current.conversationId),high=old.messages.at(-1).id;await linkVisitorIdentity(c.key,c.token,{action:"identify",anonymousToken:anon.token},db);
  assert.equal((await c.client.conversations()).unreadCount,2);assert.equal((await c.client.markRead(current.conversationId,high,old.readRevision)).unread,1);
  const fresh=await c.client.conversation(current.conversationId);assert.equal((await c.client.markRead(current.conversationId,high,fresh.readRevision)).unread,0);
 });
 await check("고정 시각 커서는 경계 문의의 새 답변 이후에도 다음 페이지를 중복 없이 이어감",async()=>{
  const c=await customer(),rows=await db.insert(s.inboxConversations).values(Array.from({length:55},(_,i)=>({orgId:actor.orgId,channelId:channels.dh.id,contactId:c.contact.id,name:"가상 고정 커서 "+i,tokenHash:randomUUID().replaceAll("-","").repeat(2),isCurrent:i===0,lastMessageAt:new Date(1700000000000-i*1000)}))).returning();
  await db.insert(s.inboxMessages).values(rows.map((r,i)=>({conversationId:r.id,clientId:randomUUID(),kind:"customer",body:"고정 위치 문의 "+i,authorName:"가상 고객"})));
  const page=await c.client.conversations();assert.match(page.nextBefore,/^v1\./);const boundary=page.rows.at(-1);
  await repo.sendAgentMessage(actor,boundary.id,{clientId:randomUUID(),kind:"reply",body:"목록 다음 페이지를 누르기 전 도착한 답변"},db);
  const next=await c.client.conversations(page.nextBefore);assert.equal(next.rows.length,5);assert.equal(new Set([...page.rows,...next.rows].map(r=>r.id)).size,55);
  const legacy=await c.client.conversations(next.rows.at(-1).id);assert.equal(legacy.rows.length,0);
  await assert.rejects(c.client.conversations("v1.invalid-cursor"),e=>e.status===400);await assert.rejects(c.client.conversations(randomUUID()),e=>e.status===404);
 });
 await check("0112 마이그레이션은 기존 웹·이메일·가져온 기록을 보존하고 이전 기본 문의를 유지",async()=>{
  const fs=require("node:fs"),path=require("node:path"),namespace="qa_history_upgrade_"+randomUUID().replaceAll("-","");
  const rowsOf=r=>r.rows??r;
  await db.transaction(async tx=>{
   await tx.execute(sql.raw(`CREATE SCHEMA ${namespace}`));await tx.execute(sql.raw(`SET LOCAL search_path TO ${namespace},public`));
   for(const statement of ["CREATE TABLE crm_contacts(id uuid PRIMARY KEY)","CREATE TABLE inbox_conversations(id uuid PRIMARY KEY,channel_id integer NOT NULL,contact_id uuid REFERENCES crm_contacts(id),history_only boolean NOT NULL DEFAULT false,medium varchar NOT NULL DEFAULT 'web',merged_into_id uuid,last_message_at timestamptz NOT NULL DEFAULT now())","CREATE UNIQUE INDEX inbox_contact_unique ON inbox_conversations(channel_id,contact_id) WHERE history_only=false AND medium='web'"])await tx.execute(sql.raw(statement));
   const contact=randomUUID(),current=randomUUID(),email=randomUUID(),history=randomUUID();await tx.execute(sql`INSERT INTO crm_contacts(id) VALUES(${contact}::uuid)`);
   await tx.execute(sql`INSERT INTO inbox_conversations(id,channel_id,contact_id,history_only,medium) VALUES(${current}::uuid,77,${contact}::uuid,false,'web'),(${email}::uuid,77,${contact}::uuid,false,'email'),(${history}::uuid,77,${contact}::uuid,true,'web')`);
   for(const statement of fs.readFileSync(path.resolve(__dirname,"../drizzle/0112_inbox_customer_history.sql"),"utf8").replaceAll("--> statement-breakpoint","").split(";"))if(statement.trim())await tx.execute(sql.raw(statement));
   const existing=rowsOf(await tx.execute(sql`SELECT id,is_current,customer_create_key FROM inbox_conversations`));assert.equal(existing.length,3);assert.ok(existing.every(r=>r.is_current===true&&r.customer_create_key===null));
   const previous=randomUUID();await tx.execute(sql`INSERT INTO inbox_conversations(id,channel_id,contact_id,is_current) VALUES(${previous}::uuid,77,${contact}::uuid,false)`);
   await tx.execute(sql`INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES(${current}::uuid,${contact}::uuid)`);
   const [read]=rowsOf(await tx.execute(sql`SELECT last_message_id,merged_unread_ids,read_revision FROM inbox_customer_reads`));assert.equal(read.last_message_id,0);assert.deepEqual(read.merged_unread_ids,[]);assert.equal(read.read_revision,0);
   const [index]=rowsOf(await tx.execute(sql`SELECT indexdef FROM pg_indexes WHERE schemaname=${namespace} AND indexname='inbox_contact_unique'`));assert.match(index.indexdef,/is_current/);assert.match(index.indexdef,/merged_into_id IS NULL/);
   await tx.execute(sql.raw(`DROP SCHEMA ${namespace} CASCADE`));
  });
 });
 await check("새 문의·기본 보내기·비회원 연결 경합은 공통 잠금 순서로 완료",async()=>{
  const c=await customer(),anon=await repo.startVisitorSession(c.key,{name:"가상 잠금 순서 검수"},db);await repo.sendVisitorMessage(c.key,anon.token,{clientId:randomUUID(),body:"연결할 비회원 질문"},db);
  await c.client.createConversation({clientId:randomUUID(),body:"경합 전 기본 문의"});
  const history=require("../src/lib/inbox-customer-history/repository.ts"),operations=[...Array.from({length:4},(_,i)=>history.createCustomerConversation(c.key,c.token,{clientId:randomUUID(),body:"새 문의 경합 "+i},db)),...Array.from({length:4},(_,i)=>repo.sendVisitorMessage(c.key,c.token,{clientId:randomUUID(),body:"기본 문의 경합 "+i},db)),linkVisitorIdentity(c.key,c.token,{action:"identify",anonymousToken:anon.token},db)];
  let timer;try{await Promise.race([Promise.all(operations),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("고객 문의 경합 검사 시간 초과")),15000);})]);}finally{clearTimeout(timer);}
  const page=await c.client.conversations();assert.equal(page.rows.length,5);assert.equal(page.rows.filter(r=>r.isCurrent).length,1);assert.equal(page.rows.reduce((sum,r)=>sum+r.unread,0),0);
  const messages=(await Promise.all(page.rows.map(r=>c.client.conversation(r.id)))).flatMap(r=>r.messages);assert.equal(messages.filter(m=>m.body.startsWith("기본 문의 경합 ")).length,4);assert.equal(messages.filter(m=>m.body==="연결할 비회원 질문").length,1);
 });
 await check("첫 읽음 ACK의 contact FK와 새 문의의 기본 연결 변경도 교착 없이 완료",async()=>{
  const c=await customer(),initial=await c.client.createConversation({clientId:randomUUID(),body:"읽음 경합의 원래 기본 문의"}),history=require("../src/lib/inbox-customer-history/repository.ts");
  const operations=[...Array.from({length:4},(_,i)=>history.createCustomerConversation(c.key,c.token,{clientId:randomUUID(),body:"읽음과 새 문의 경합 "+i},db)),...Array.from({length:4},()=>history.markCustomerConversationRead(c.key,c.token,initial.conversationId,{lastMessageId:initial.id,readRevision:0},db))];
  let timer;try{await Promise.race([Promise.all(operations),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("읽음·새 문의 경합 검사 시간 초과")),15000);})]);}finally{clearTimeout(timer);}
  const page=await c.client.conversations();assert.equal(page.rows.length,5);assert.equal(page.rows.filter(r=>r.isCurrent).length,1);assert.equal((await c.client.markRead(initial.conversationId,initial.id,0)).lastMessageId,initial.id);
 });
 console.log(`고객 문의 목록/새 문의 ${process.argv.includes("--postgres")?"PostgreSQL":"PGlite"} QA ${n}개 통과 · 가상 고객 전용 · 외부 발송/운영 DB 접근 없음`);await pg.close();
}
(process.argv.includes("--postgres")?require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck(scenario):runPlatformCheck(scenario)).catch(e=>{console.error(e);process.exitCode=1;});
