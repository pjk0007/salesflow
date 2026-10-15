/* eslint-disable @typescript-eslint/no-require-imports -- 실제 0111→0112 SQL의 메모리 PGlite 업그레이드 검수 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { fixture } = require("./check-inbox.cjs");
const { PGlite } = require(
    path.resolve(__dirname, "../.testenv/test-runtime/node_modules/@electric-sql/pglite"),
);
const { drizzle } = require("drizzle-orm/pglite");
const schema = require("../src/lib/db/schema.ts");

const migrationPath = path.resolve(__dirname, "../drizzle/0112_inbox_customer_history.sql");
const migrationSource = fs.readFileSync(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migrationSource).digest("hex");
const migrationStatements = migrationSource
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error("업그레이드 검수의 외부 네트워크 사용 금지"); };

async function main() {
    // No dataDir, URL, environment file, or network client: this database exists only in memory.
    const memory = new PGlite();
    let checks = 0;
    const check = async (name, action) => {
        await action();
        console.log(`PASS CUSTOMER HISTORY UPGRADE ${++checks} ${name}`);
    };
    const query = async (sql, params = []) => (await memory.query(sql, params)).rows;
    const rejectsCode = (sql, params, code) => assert.rejects(
        query(sql, params),
        (error) => error.code === code,
    );
    try {
        // Reuse the real fixture and its 0088–0111 migrations. Hold only exact statements
        // from the actual 0112 file; never emulate an old schema or edit shared helpers.
        const held = [];
        const pg = {
            waitReady: memory.waitReady,
            query: memory.query.bind(memory),
            close: memory.close.bind(memory),
            exec: async (sql) => {
                const statement = sql.trim();
                if (migrationStatements.includes(statement)) {
                    held.push(statement);
                    return [];
                }
                return memory.exec(sql);
            },
        };
        const { actor } = await fixture({ pg, db: drizzle(memory, { schema }) });
        await check("실제 0111까지 적용하고 실제 0112 SQL만 보류", async () => {
            assert.deepEqual(held, migrationStatements);
            const [tables] = await query("SELECT to_regclass('customer_import_files')::text AS prior, to_regclass('inbox_customer_reads')::text AS future");
            assert.equal(tables.prior, "customer_import_files");
            assert.equal(tables.future, null);
            assert.deepEqual(await query("SELECT column_name FROM information_schema.columns WHERE table_name='inbox_conversations' AND column_name IN ('is_current','customer_create_key')"), []);
        });

        const ids = Object.fromEntries([
            "contact", "otherContact", "company", "member", "anonymous", "historic",
            "email", "merged", "otherMember", "mailbox", "job", "oldCreateKey",
        ].map((name) => [name, randomUUID()]));
        const channels = { dh: 9001, bo: 9002 };
        for (const [business, workspace] of [["dh", 8], ["bo", 10]]) {
            await query("INSERT INTO inbox_channels(id,org_id,workspace_id,public_key,name,enabled) VALUES($1,$2,$3,$4,$5,true)",
                [channels[business], actor.orgId, workspace, `upgrade-${business}-${randomUUID()}`, `가상 업그레이드 ${business}`]);
        }
        for (const [id, workspace, record] of [[ids.contact, 8, 1], [ids.otherContact, 10, 2]]) {
            await query("INSERT INTO crm_contacts(id,org_id,workspace_id,external_id,name,record_id,attributes) VALUES($1,$2,$3,'same-external-member','가상 기존 회원',$4,$5::jsonb)",
                [id, actor.orgId, workspace, record, JSON.stringify({ legacy: true })]);
        }
        await query("INSERT INTO crm_companies(id,org_id,workspace_id,external_id,name) VALUES($1,$2,8,'upgrade-company','가상 기존 회사')", [ids.company, actor.orgId]);
        await query("INSERT INTO crm_contact_companies(contact_id,company_id) VALUES($1,$2)", [ids.contact, ids.company]);
        const chatSeeds = [
            [ids.member, channels.dh, ids.contact, false, "web", null, "closed", 1],
            [ids.anonymous, channels.dh, null, false, "web", null, "open", null],
            [ids.historic, channels.dh, ids.contact, true, "web", null, "closed", 1],
            [ids.email, channels.dh, ids.contact, false, "email", null, "snoozed", 1],
            [ids.merged, channels.dh, null, false, "web", ids.member, "closed", null],
            [ids.otherMember, channels.bo, ids.otherContact, false, "web", null, "open", 2],
        ];
        for (const [id, channel, contact, historyOnly, medium, mergedInto, status, record] of chatSeeds) {
            await query(`INSERT INTO inbox_conversations
                (id,channel_id,org_id,token_hash,contact_id,name,status,assignee_id,record_id,
                 history_only,medium,merged_into_id,tags,preview,last_message_at,created_at,customer_seq,import_metadata)
                VALUES($1,$2,$3,$4,$5,'가상 기존 상담',$6,$7,$8,$9,$10,$11,'["기존 태그"]',
                       '기존 미리보기','2026-01-02T03:04:05.678Z','2025-12-01T01:02:03.456Z',2,$12::jsonb)`,
                [id, channel, actor.orgId, createHash("sha256").update(id).digest("hex"), contact,
                    status, actor.userId, record, historyOnly, medium, mergedInto,
                    historyOnly ? JSON.stringify({ source: "fictional", originalId: "historic-1" }) : null]);
        }
        const messageIds = {};
        const attachments = [];
        for (const [name, chat, channel] of [
            ["member", ids.member, channels.dh], ["anonymous", ids.anonymous, channels.dh],
            ["historic", ids.historic, channels.dh], ["email", ids.email, channels.dh],
            ["otherMember", ids.otherMember, channels.bo],
        ]) {
            messageIds[name] = {};
            for (const kind of ["customer", "reply", "note"]) {
                const [message] = await query(`INSERT INTO inbox_messages
                    (conversation_id,client_id,kind,body,author_id,author_name,origin_conversation_id,created_at)
                    VALUES($1,$2,$3,$4,$5,'가상 작성자',$6,'2026-01-02T03:04:05.678Z') RETURNING id`,
                    [chat, randomUUID(), kind, `${name} 기존 ${kind} 본문`, kind === "customer" ? null : actor.userId,
                        name === "member" && kind === "reply" ? ids.merged : null]);
                messageIds[name][kind] = message.id;
                if (kind === "customer") continue;
                const attachmentId = randomUUID();
                const bytes = Buffer.from(`%PDF-1.4\n${name}/${kind} fictional original bytes\0\xff`, "utf8");
                const hash = createHash("sha256").update(bytes).digest("hex");
                await query(`INSERT INTO inbox_attachments
                    (id,org_id,channel_id,draft_conversation_id,message_id,owner_key,client_id,kind,file_name,content_type,size,sha256,import_metadata)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'application/pdf',$10,$11,$12::jsonb)`,
                    [attachmentId, actor.orgId, channel, chat, message.id, "a".repeat(64), randomUUID(), kind,
                        `${name}-${kind}.pdf`, bytes.length, hash,
                        name === "historic" ? JSON.stringify({ sourceFile: `old-${kind}` }) : null]);
                await query("INSERT INTO inbox_attachment_blobs(attachment_id,bytes) VALUES($1,decode($2,'hex'))", [attachmentId, bytes.toString("hex")]);
                attachments.push({ id: attachmentId, messageId: message.id, chatId: chat, name, kind, bytes, hash });
            }
        }
        await query("INSERT INTO inbox_reads(conversation_id,user_id,customer_seq) VALUES($1,$2,2)", [ids.member, actor.userId]);
        await query("INSERT INTO inbox_audit_events(org_id,channel_id,conversation_id,actor_id,actor_name,action,changes) VALUES($1,$2,$3,$4,'가상 직원','status.changed',$5::jsonb)",
            [actor.orgId, channels.dh, ids.member, actor.userId, JSON.stringify({ before: "open", after: "closed" })]);
        await query("INSERT INTO inbox_mailboxes(id,org_id,workspace_id,channel_id,address,name) VALUES($1,$2,8,$3,'fixture@example.test','가상 기존 메일함')", [ids.mailbox, actor.orgId, channels.dh]);
        await query("INSERT INTO inbox_email_threads(conversation_id,mailbox_id,provider_thread_id,correspondent,subject,last_rfc_message_id,last_received_at) VALUES($1,$2,'fixture-thread','customer@example.test','가상 기존 메일','<fixture@example.test>','2026-01-02T03:04:05.678Z')", [ids.email, ids.mailbox]);
        await query("INSERT INTO customer_imports(id,org_id,workspace_id,source,namespace,state,input,plan,fingerprint,created_by) VALUES($1,$2,8,'channel','upgrade','completed','{}','{}',$3,$4)", [ids.job, actor.orgId, "b".repeat(64), actor.userId]);
        await query("INSERT INTO customer_import_objects(org_id,workspace_id,source,namespace,kind,source_id,target_id,source_fingerprint,target_fingerprint,owned,job_id) VALUES($1,8,'channel','upgrade','conversation','historic-1',$2,$3,$3,true,$4)", [actor.orgId, ids.historic, "c".repeat(64), ids.job]);
        const imported = attachments.find((item) => item.name === "historic" && item.kind === "reply");
        await query(`INSERT INTO customer_import_files
            (org_id,workspace_id,job_id,message_id,source_key,manifest,file_name,expected_size,expected_sha256,locator,state,attachment_id)
            VALUES($1,8,$2,$3,$4,$5,'historic-reply.pdf',$6,$7,'{"fixture":true}','ready',$8)`,
            [actor.orgId, ids.job, imported.messageId, "d".repeat(64), "e".repeat(64), imported.bytes.length, imported.hash, imported.id]);

        const insertChat = (id, contact, { channel = channels.dh, current = false, key = null, history = false, medium = "web", merged = null } = {}) => query(`INSERT INTO inbox_conversations
            (id,channel_id,org_id,token_hash,contact_id,name,is_current,customer_create_key,history_only,medium,merged_into_id)
            VALUES($1,$2,$3,$4,$5,'가상 새 상담',$6,$7,$8,$9,$10)`,
            [id, channel, actor.orgId, createHash("sha256").update(id).digest("hex"), contact, current, key, history, medium, merged]);
        await check("0111의 단일 회원 웹 상담 제약이 실제로 존재", async () => {
            await rejectsCode("INSERT INTO inbox_conversations(channel_id,org_id,token_hash,contact_id,name) VALUES($1,$2,$3,$4,'생성되면 안 됨')",
                [channels.dh, actor.orgId, "f".repeat(64), ids.contact], "23505");
        });
        const tables = [
            "inbox_channels", "crm_contacts", "crm_companies", "crm_contact_companies",
            "inbox_conversations", "inbox_messages", "inbox_reads", "inbox_attachments",
            "inbox_attachment_blobs", "inbox_audit_events", "inbox_mailboxes", "inbox_email_threads",
            "customer_imports", "customer_import_objects", "customer_import_files",
        ];
        const snapshot = async (after = false) => Object.fromEntries(await Promise.all(tables.map(async (table) => {
            // Identifiers come only from the fixed local allowlist above.
            const projection = after && table === "inbox_conversations"
                ? "to_jsonb(t)-'is_current'-'customer_create_key'" : "to_jsonb(t)";
            return [table, await query(`SELECT ${projection} AS row FROM ${table} t ORDER BY (${projection})::text`)];
        })));
        const before = await snapshot();
        await check("실제 0112 SQL을 기존 가상 데이터에 적용", async () => {
            assert.equal(fs.readFileSync(migrationPath, "utf8"), migrationSource, "검수 중 0112가 변경됨: 최신 소스에서 다시 실행하세요.");
            await memory.exec("BEGIN");
            try {
                for (const statement of migrationStatements) await memory.exec(statement);
                await memory.exec("COMMIT");
            } catch (error) {
                await memory.exec("ROLLBACK");
                throw error;
            }
            assert.equal((await query("SELECT to_regclass('inbox_customer_reads')::text AS name"))[0].name, "inbox_customer_reads");
        });
        await check("기존 15개 테이블의 모든 행·컬럼·관계·본문·감사·첨부 바이트 보존", async () => {
            assert.deepEqual(await snapshot(true), before);
            const rows = await query("SELECT id,is_current,customer_create_key FROM inbox_conversations ORDER BY id");
            assert.equal(rows.length, chatSeeds.length);
            assert.ok(rows.every((row) => row.is_current === true && row.customer_create_key === null));
            assert.deepEqual(await query("SELECT * FROM inbox_customer_reads"), []);
        });
        await check("기존 두 사업 회원의 현재 웹 문의는 각각 하나이며 이력·메일·병합은 제외", async () => {
            const current = await query("SELECT id FROM inbox_conversations WHERE contact_id IS NOT NULL AND history_only=false AND medium='web' AND is_current=true AND merged_into_id IS NULL ORDER BY id");
            assert.deepEqual(current.map((row) => row.id).sort(), [ids.member, ids.otherMember].sort());
        });
        await check("공개 답변·비공개 메모 첨부 10개의 원본 bytes와 SHA256·소유 관계 보존", async () => {
            assert.equal(attachments.length, 10);
            for (const attachment of attachments) {
                const [saved] = await query(`SELECT a.message_id,a.draft_conversation_id,a.kind,a.sha256,a.size,encode(b.bytes,'hex') AS hex
                    FROM inbox_attachments a JOIN inbox_attachment_blobs b ON b.attachment_id=a.id WHERE a.id=$1`, [attachment.id]);
                assert.equal(saved.hex, attachment.bytes.toString("hex"));
                assert.equal(createHash("sha256").update(Buffer.from(saved.hex, "hex")).digest("hex"), saved.sha256);
                assert.equal(saved.size, attachment.bytes.length);
                assert.equal(saved.message_id, attachment.messageId);
                assert.equal(saved.draft_conversation_id, attachment.chatId);
                assert.equal(saved.kind, attachment.kind);
            }
        });
        const additional = randomUUID();
        await check("동일 회원의 과거 웹 문의를 추가할 수 있고 현재 문의 중복은 차단", async () => {
            await insertChat(additional, ids.contact, { key: ids.oldCreateKey });
            await assert.rejects(insertChat(randomUUID(), ids.contact, { current: true }), (error) => error.code === "23505");
            assert.equal((await query("SELECT is_current FROM inbox_conversations WHERE id=$1", [ids.member]))[0].is_current, true);
        });
        await check("새 문의 멱등 키는 같은 사업·회원에서 중복을 막고 다른 사업은 허용", async () => {
            await assert.rejects(insertChat(randomUUID(), ids.contact, { key: ids.oldCreateKey }), (error) => error.code === "23505");
            await insertChat(randomUUID(), ids.otherContact, { channel: channels.bo, key: ids.oldCreateKey });
        });
        await check("현재 문의 교체 후 기존 상태·담당·관계를 보존하고 문의 수는 유지", async () => {
            await memory.exec("BEGIN");
            try {
                await query("UPDATE inbox_conversations SET is_current=false WHERE id=$1", [ids.member]);
                await query("UPDATE inbox_conversations SET is_current=true WHERE id=$1", [additional]);
                await memory.exec("COMMIT");
            } catch (error) {
                await memory.exec("ROLLBACK");
                throw error;
            }
            const [old] = await query("SELECT status,assignee_id,record_id,is_current FROM inbox_conversations WHERE id=$1", [ids.member]);
            assert.deepEqual(old, { status: "closed", assignee_id: actor.userId, record_id: 1, is_current: false });
            const current = await query("SELECT id FROM inbox_conversations WHERE channel_id=$1 AND contact_id=$2 AND history_only=false AND medium='web' AND is_current=true AND merged_into_id IS NULL", [channels.dh, ids.contact]);
            assert.deepEqual(current, [{ id: additional }]);
            assert.equal(Number((await query("SELECT count(*) AS n FROM inbox_conversations"))[0].n), chatSeeds.length + 2);
        });
        await check("과거 기록·메일·병합 행과 여러 익명 상담은 현재 회원 문의 고유성에서 제외", async () => {
            await insertChat(randomUUID(), ids.contact, { current: true, history: true });
            await insertChat(randomUUID(), ids.contact, { current: true, medium: "email" });
            await insertChat(randomUUID(), ids.contact, { current: true, merged: additional });
            await insertChat(randomUUID(), null, { current: true });
            await insertChat(randomUUID(), null, { current: true });
        });
        await check("고객 읽음의 기본값·복합 고유성·음수 제한·존재하지 않는 상담/고객 FK", async () => {
            const [read] = await query("INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES($1,$2) RETURNING *", [ids.member, ids.contact]);
            assert.equal(read.last_message_id, 0);
            assert.deepEqual(read.merged_unread_ids, []);
            assert.equal(read.read_revision, 0);
            await rejectsCode("INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES($1,$2)", [ids.member, ids.contact], "23505");
            await rejectsCode("INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES($1,$2)", [randomUUID(), ids.contact], "23503");
            await rejectsCode("INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES($1,$2)", [ids.member, randomUUID()], "23503");
            await rejectsCode("UPDATE inbox_customer_reads SET last_message_id=-1 WHERE conversation_id=$1", [ids.member], "23514");
            await rejectsCode("UPDATE inbox_customer_reads SET read_revision=-1 WHERE conversation_id=$1", [ids.member], "23514");
        });
        await check("읽음 데이터는 기존 직원 읽음과 독립이며 문의·고객 삭제 시 고아 행 없음", async () => {
            await query("UPDATE inbox_customer_reads SET last_message_id=$1 WHERE conversation_id=$2 AND contact_id=$3", [messageIds.member.reply, ids.member, ids.contact]);
            assert.deepEqual(await query("SELECT customer_seq FROM inbox_reads WHERE conversation_id=$1 AND user_id=$2", [ids.member, actor.userId]), [{ customer_seq: 2 }]);
            const disposableChat = randomUUID();
            await insertChat(disposableChat, ids.contact);
            await query("INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES($1,$2)", [disposableChat, ids.contact]);
            await query("DELETE FROM inbox_conversations WHERE id=$1", [disposableChat]);
            assert.deepEqual(await query("SELECT * FROM inbox_customer_reads WHERE conversation_id=$1", [disposableChat]), []);
            const disposableContact = randomUUID();
            await query("INSERT INTO crm_contacts(id,org_id,workspace_id,external_id,name) VALUES($1,$2,8,'disposable-upgrade','가상 삭제 검수')", [disposableContact, actor.orgId]);
            const remainingChat = randomUUID();
            await insertChat(remainingChat, disposableContact);
            await query("INSERT INTO inbox_customer_reads(conversation_id,contact_id) VALUES($1,$2)", [remainingChat, disposableContact]);
            await query("DELETE FROM crm_contacts WHERE id=$1", [disposableContact]);
            assert.deepEqual(await query("SELECT * FROM inbox_customer_reads WHERE contact_id=$1", [disposableContact]), []);
            assert.deepEqual(await query("SELECT contact_id FROM inbox_conversations WHERE id=$1", [remainingChat]), [{ contact_id: null }]);
        });
        assert.equal(fs.readFileSync(migrationPath, "utf8"), migrationSource, "검수 중 0112가 변경됨: 최신 소스에서 다시 실행하세요.");
        console.log(`고객 문의 0111→0112 메모리 PGlite 업그레이드 QA ${checks}개 통과 · 실제 DB/환경 파일/외부 발송 사용 없음`);
        console.log(`검수한 0112 SHA256 ${migrationHash}`);
    } finally {
        await memory.close();
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => { global.fetch = originalFetch; });
