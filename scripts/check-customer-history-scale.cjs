/* eslint-disable @typescript-eslint/no-require-imports -- 가상 대량 상담의 격리 API·SQL 정확성 및 측정 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");

function options(argv) {
    const smoke = argv.includes("--smoke");
    const result = { postgres: argv.includes("--postgres"), smoke, conversations: smoke ? 600 : 10000,
        messages: 10, members: smoke ? 2 : 10, samples: smoke ? 3 : 10, maxSeconds: 180 };
    const numeric = { conversations: [200, 20000], messages: [10, 20], members: [2, 20], samples: [3, 20], "max-seconds": [30, 600] };
    for (const argument of argv) {
        if (["--smoke", "--postgres"].includes(argument)) continue;
        const match = /^--([a-z-]+)=(\d+)$/.exec(argument);
        if (!match || !numeric[match[1]]) throw new Error(`지원하지 않는 옵션: ${argument}`);
        const value = Number(match[2]), [min, max] = numeric[match[1]];
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${match[1]} 범위: ${min}..${max}`);
        result[match[1] === "max-seconds" ? "maxSeconds" : match[1]] = value;
    }
    if (result.conversations % (2 * result.members) !== 0) throw new Error("conversations는 2×members의 배수여야 합니다.");
    if (result.conversations < 2 * result.members * 10) throw new Error("각 회원에게 최소 10개 문의가 필요합니다.");
    if (result.conversations * result.messages > 200000) throw new Error("기본 메시지는 최대 200,000개입니다.");
    return result;
}
const root = path.resolve(__dirname, "..");
const sourcePaths = [
    "scripts/check-customer-history-scale.cjs", "scripts/check-inbox.cjs", "scripts/check-customer-platform.cjs",
    "scripts/customer-platform-test-postgres.cjs", "sdk/messenger.ts", "src/lib/inbox/repository.ts",
    "src/lib/inbox-customer-history/repository.ts", "src/lib/inbox-customer-history/rules.ts",
    "src/lib/inbox-customer-history/routes.ts", "src/lib/customer-platform/messenger-http.ts",
    "src/lib/db/inbox-schema.ts", "src/lib/db/inbox-customer-history-schema.ts", "src/lib/db/schema.ts",
    "src/app/api/inbox/route.ts", "src/app/api/messenger/[key]/route.ts",
    ...fs.readdirSync(path.join(root, "drizzle")).filter((name) => /^(00(?:8[8-9]|9\d)|01(?:0\d|1[0-2]))_.+\.sql$/.test(name)).map((name) => `drizzle/${name}`),
];
function sourceHashes() {
    return sourcePaths.map((name) => ({ path: name, sha256: createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex") }));
}
function version(name) {
    try { return JSON.parse(fs.readFileSync(path.join(root, name), "utf8")).version; } catch { return null; }
}
const round = (number) => Number(number.toFixed(3));
const ordered = (rows) => [...rows].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

async function run(config, report, started) {
    const { runPlatformCheck } = require("./check-customer-platform.cjs");
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error("대량 검수의 외부 HTTP 요청 금지"); };
    const deadline = () => {
        if ((performance.now() - started) / 1000 > config.maxSeconds) throw new Error("검수 시간 예산 초과: 다음 요청을 중지하고 가상 DB를 정리합니다.");
    };
    async function scenario(ctx) {
        const { pg, actor, channels, clients, dispatch } = ctx;
        const query = async (sql, params = []) => { deadline(); return (await pg.query(sql, params)).rows; };
        const check = async (name, action) => { deadline(); await action(); report.checks.push(name); };
        const prefix = `scale-${randomUUID()}`;
        report.fixturePrefix = prefix;
        const [database] = await query("SELECT current_database() AS name, version() AS version");
        report.database = database;
        if (config.postgres) assert.match(database.name, /^sendb_capacity_qa_[a-f0-9]{32}$/);
        const initialCounts = (await query("SELECT (SELECT count(*)::int FROM inbox_conversations) AS conversations, (SELECT count(*)::int FROM inbox_messages) AS messages"))[0];
        const businesses = ["dh", "bo"], members = [];
        const chatRows = [], messageRows = [], readRows = [];
        const byId = new Map();
        const perBusiness = config.conversations / 2;
        const baseTime = Date.UTC(2026, 0, 1);
        let messageId = Number((await query("SELECT coalesce(max(id),0)::int AS id FROM inbox_messages"))[0].id);
        const seedStarted = performance.now();
        const contacts = [];
        for (let business = 0; business < 2; business++) {
            for (let member = 0; member < config.members; member++) {
                const contact = { id: randomUUID(), business, member, workspace: business ? 10 : 8,
                    external: `${prefix}:member:${member}`, name: `가상 대량검수 ${business}/${member}`, chats: [] };
                members.push(contact);
                contacts.push({ id: contact.id, org: actor.orgId, workspace: contact.workspace, external: contact.external, name: contact.name });
            }
        }
        await query(`INSERT INTO crm_contacts(id,org_id,workspace_id,external_id,name)
            SELECT id,org,workspace,external,name FROM jsonb_to_recordset($1::jsonb)
            AS x(id uuid,org uuid,workspace integer,external text,name text)`, [JSON.stringify(contacts)]);
        const firstByOwner = new Map();
        for (let index = 0; index < config.conversations; index++) {
            const business = Math.floor(index / perBusiness), local = index % perBusiness;
            const member = members[business * config.members + local % config.members];
            const phase = Math.floor(local / config.members) % 10;
            const kind = phase === 7 ? "history" : phase === 8 ? "email"
                : phase === 9 ? (Math.floor(local / (config.members * 10)) % 2 ? "merged" : "notes") : "web";
            const id = randomUUID(), first = !firstByOwner.has(member.id);
            if (first) firstByOwner.set(member.id, id);
            const at = new Date(baseTime + Math.floor(local / 25) * 1000).toISOString();
            const chat = { id, index, local, business, owner: member.id, kind, at, publicMessages: [], unread: 0,
                needle: local % 2 === 0, current: first, messageIds: [], mergedIds: [], cutoff: 0 };
            member.chats.push(chat); byId.set(id, chat);
            // One dense conversation crosses the public detail's 100-message boundary.
            const messageCount = index === 0 ? 180 : config.messages;
            for (let position = 0; position < messageCount; position++) {
                const messageKind = kind === "notes" || position % 5 === 4 ? "note" : [1, 2].includes(position % 5) ? "reply" : "customer";
                const body = messageKind === "note" ? `${prefix} PRIVATE NOTE ${index}/${position}`
                    : `${prefix} public ${index}/${position}`;
                const fullBody = body + (position === 0 && chat.needle ? ` ${prefix} needle` : "");
                const message = { id: ++messageId, chat: id, client: randomUUID(), kind: messageKind, body: fullBody, at };
                messageRows.push(message); chat.messageIds.push(message.id);
                if (messageKind !== "note") chat.publicMessages.push(message);
            }
            if (kind === "web") {
                const replies = chat.publicMessages.filter((message) => message.kind === "reply");
                const mode = Math.floor(local / config.members) % 3;
                if (mode) {
                    chat.cutoff = mode === 1 ? chat.publicMessages[Math.floor(chat.publicMessages.length / 2)].id : chat.publicMessages.at(-1).id;
                    chat.mergedIds = mode === 2 ? [replies[0].id] : [];
                    readRows.push({ chat: id, contact: member.id, cutoff: chat.cutoff, merged: chat.mergedIds, revision: mode === 2 ? 1 : 0 });
                }
                chat.unread = replies.filter((message) => message.id > chat.cutoff || chat.mergedIds.includes(message.id)).length;
            }
            chatRows.push({ id, org: actor.orgId, channel: channels[businesses[business]].id, contact: member.id,
                token: createHash("sha256").update(`${prefix}:${id}`).digest("hex"), name: `${prefix} chat ${index}`,
                history: kind === "history", medium: kind === "email" ? "email" : "web", current: first,
                merged: kind === "merged" ? firstByOwner.get(member.id) : null, at,
                preview: chat.publicMessages.at(-1)?.body ?? "", customerSeq: chat.publicMessages.filter((message) => message.kind === "customer").length });
        }
        async function batches(rows, size, sql) {
            for (let offset = 0; offset < rows.length; offset += size) await query(sql, [JSON.stringify(rows.slice(offset, offset + size))]);
        }
        try {
            await batches(chatRows, 500, `INSERT INTO inbox_conversations
                (id,org_id,channel_id,contact_id,token_hash,name,history_only,medium,is_current,merged_into_id,last_message_at,created_at,preview,customer_seq)
                SELECT id,org,channel,contact,token,name,history,medium,current,merged,at,at,preview,"customerSeq"
                FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,org uuid,channel integer,contact uuid,token text,name text,
                history boolean,medium text,current boolean,merged uuid,at timestamptz,preview text,"customerSeq" integer)`);
            await batches(messageRows, 5000, `INSERT INTO inbox_messages(id,conversation_id,client_id,kind,body,author_name,created_at)
                SELECT id,chat,client,kind,body,'가상 대량검수 작성자',at FROM jsonb_to_recordset($1::jsonb)
                AS x(id integer,chat uuid,client uuid,kind text,body text,at timestamptz)`);
            await query("SELECT setval(pg_get_serial_sequence('inbox_messages','id'),$1,true)", [messageId]);
            await batches(readRows, 1000, `INSERT INTO inbox_customer_reads(conversation_id,contact_id,last_message_id,merged_unread_ids,read_revision)
                SELECT chat,contact,cutoff,merged,revision FROM jsonb_to_recordset($1::jsonb)
                AS x(chat uuid,contact uuid,cutoff integer,merged integer[],revision integer)`);
            for (const table of ["inbox_conversations", "inbox_messages", "inbox_customer_reads", "crm_contacts"]) await query(`ANALYZE ${table}`);
            report.seed = { elapsedMs: round(performance.now() - seedStarted), conversations: chatRows.length,
                messages: messageRows.length, customerReadRows: readRows.length, members: members.length, businesses: 2,
                distribution: Object.fromEntries(["web", "history", "email", "notes", "merged"].map((kind) => [kind, [...byId.values()].filter((chat) => chat.kind === kind).length])) };
            report.counts = (await query("SELECT (SELECT count(*)::int FROM inbox_conversations) AS conversations, (SELECT count(*)::int FROM inbox_messages) AS messages"))[0];
            assert.equal(report.counts.conversations, initialCounts.conversations + chatRows.length);
            assert.equal(report.counts.messages, initialCounts.messages + messageRows.length);
            const { SendbMessengerClient } = require("../sdk/messenger.ts");
            for (const member of members) {
                const channel = channels[businesses[member.business]];
                const token = (await clients[businesses[member.business]].customerIdentity(channel.id, member.id)).identityToken;
                member.token = token;
                member.client = new SendbMessengerClient({ apiBase: "http://127.0.0.1:3120", channelKey: channel.publicKey,
                    getToken: () => token, fetchImpl: dispatch });
                member.visible = ordered(member.chats.filter((chat) => chat.kind === "web"));
            }
            const expectedUnread = (member) => member.visible.reduce((sum, chat) => sum + chat.unread, 0);
            const assertPage = (member, page) => {
                assert.equal(page.unreadCount, expectedUnread(member));
                assert.ok(page.rows.length <= 50);
                for (const row of page.rows) {
                    const expected = byId.get(row.id);
                    assert.ok(expected && expected.kind === "web" && expected.owner === member.id);
                    assert.equal(row.unread, expected.unread);
                    assert.equal(row.title, expected.publicMessages.find((message) => message.kind === "customer").body.slice(0, 120));
                    assert.equal(row.preview, expected.publicMessages.at(-1).body.slice(0, 200));
                    assert.equal(row.isCurrent, expected.current);
                    assert.ok(!JSON.stringify(row).includes("PRIVATE NOTE"));
                }
            };
            await check("2사업 모든 회원의 전체 목록 ID·순서·50건 커서·정확한 미읽음·메모 제외", async () => {
                for (const member of members) {
                    let cursor, turns = 0; const actual = [];
                    do {
                        deadline();
                        const page = await member.client.conversations(cursor); assertPage(member, page);
                        actual.push(...page.rows.map((row) => row.id));
                        assert.ok(++turns <= Math.ceil(member.visible.length / 50) + 1);
                        assert.equal(page.hasMore, actual.length < member.visible.length);
                        if (!page.hasMore) { assert.equal(page.nextBefore, null); break; }
                        assert.ok(page.nextBefore && page.nextBefore !== cursor); cursor = page.nextBefore;
                    } while (true);
                    assert.deepEqual(actual, member.visible.map((chat) => chat.id));
                }
            });
            const target = members[0], dense = target.chats[0];
            let detailFirst, detailOlder;
            await check("고객 상세의 모든 공개 메시지 ID·내용·100건 이전 커서와 내부 필드 제외", async () => {
                let cursor, count = 0; const actual = [];
                do {
                    deadline();
                    const detail = await target.client.conversation(dense.id, cursor);
                    assert.equal(detail.conversationId, dense.id);
                    if (!cursor) detailFirst = detail; else detailOlder = detail;
                    assert.ok(!JSON.stringify(detail).includes("PRIVATE NOTE"));
                    for (const message of detail.messages) {
                        assert.ok(!Object.hasOwn(message, "authorId")); assert.ok(!Object.hasOwn(message, "recordId"));
                        assert.notEqual(message.kind, "note");
                    }
                    actual.unshift(...detail.messages.map((message) => ({ id: message.id, body: message.body, kind: message.kind })));
                    assert.ok(++count <= Math.ceil(dense.publicMessages.length / 100) + 1);
                    if (!detail.hasOlder) break;
                    cursor = detail.messages[0].id;
                } while (true);
                assert.deepEqual(actual, dense.publicMessages.map(({ id, body, kind }) => ({ id, body, kind })));
                assert.ok(detailFirst.hasOlder && detailOlder && !detailOlder.hasOlder);
            });
            await check("다른 회원·사업 및 과거/메일/병합 상세·읽음 차단", async () => {
                for (const hidden of target.chats.filter((chat) => ["history", "email", "merged"].includes(chat.kind)).slice(0, 12)) {
                    await assert.rejects(target.client.conversation(hidden.id), (error) => error.status === 404);
                    await assert.rejects(target.client.markRead(hidden.id, hidden.messageIds[0]), (error) => error.status === 404);
                }
                await assert.rejects(target.client.conversation(members[1].visible[0].id), (error) => error.status === 404);
                await assert.rejects(target.client.markRead(members[1].visible[0].id, members[1].visible[0].publicMessages[0].id), (error) => error.status === 404);
                const foreign = members[config.members];
                await assert.rejects(target.client.conversation(foreign.visible[0].id), (error) => error.status === 404);
                const response = await dispatch(`http://127.0.0.1:3120/api/messenger/${channels.dh.publicKey}/conversations`, { headers: { Authorization: `Bearer ${foreign.token}` } });
                assert.equal(response.status, 401);
                const notes = target.chats.find((chat) => chat.kind === "notes");
                assert.deepEqual((await target.client.conversation(notes.id)).messages, []);
            });
            const { generateToken } = require("../src/lib/auth.ts");
            const staffToken = generateToken(actor);
            const staffSearch = async (business, cursor, history = false) => {
                const params = new URLSearchParams({ channelId: String(channels[businesses[business]].id), view: "list", q: `${prefix} needle`, ...(history ? { filter: "history" } : {}) });
                if (cursor) { params.set("before", cursor.lastMessageAt); params.set("beforeId", cursor.id); }
                const response = await dispatch(`http://127.0.0.1:3120/api/inbox?${params}`, { headers: { Authorization: `Bearer ${staffToken}` } });
                assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.success, true); return body.data;
            };
            const staffExpected = (business, history = false) => ordered([...byId.values()].filter((chat) => chat.business === business && chat.needle && chat.kind !== "merged" && (history ? chat.kind === "history" : chat.kind !== "history")));
            const staffPages = [];
            await check("직원 전체 본문 검색의 2사업 ID·100건 커서·전체/과거 집계 정확성", async () => {
                for (let business = 0; business < 2; business++) {
                    const expected = staffExpected(business); const actual = []; let cursor, turns = 0;
                    do {
                        deadline(); const page = await staffSearch(business, cursor);
                        if (business === 0) staffPages.push(page);
                        assert.equal(page.counts.all, expected.length);
                        assert.equal(page.counts.history, staffExpected(business, true).length);
                        actual.push(...page.rows.map((row) => row.id));
                        assert.ok(++turns <= Math.ceil(expected.length / 100) + 1);
                        if (!page.hasMore) break;
                        assert.equal(page.rows.length, 100); cursor = page.rows.at(-1);
                    } while (true);
                    assert.deepEqual(actual, expected.map((chat) => chat.id));
                    const historic = await staffSearch(business, undefined, true);
                    assert.deepEqual(historic.rows.map((row) => row.id), staffExpected(business, true).slice(0, 100).map((chat) => chat.id));
                }
            });
            const metrics = [];
            async function measure(name, call, validate, rowCount) {
                deadline(); validate(await call()); // Separate one warmup from all measured samples.
                const timings = [], rows = [];
                for (let sample = 0; sample < config.samples; sample++) {
                    deadline(); const start = performance.now(), value = await call();
                    timings.push(performance.now() - start); validate(value); rows.push(rowCount(value));
                }
                const sorted = [...timings].sort((a, b) => a - b);
                metrics.push({ operation: name, samples: timings.length, warmups: 1,
                    p50Ms: round(sorted[Math.ceil(sorted.length * 0.5) - 1]), p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
                    maxMs: round(sorted.at(-1)), rows: { min: Math.min(...rows), max: Math.max(...rows) }, timingsMs: timings.map(round) });
            }
            const first = await target.client.conversations();
            await measure("customer_list_first_and_total_unread", () => target.client.conversations(), (page) => assertPage(target, page), (page) => page.rows.length);
            if (first.nextBefore) await measure("customer_list_next_cursor", () => target.client.conversations(first.nextBefore), (page) => assertPage(target, page), (page) => page.rows.length);
            else report.skippedMeasurements.push("customer_list_next_cursor: fixture has only one page");
            await measure("customer_detail_latest", () => target.client.conversation(dense.id), (detail) => assert.deepEqual(detail.messages, detailFirst.messages), (detail) => detail.messages.length);
            await measure("customer_detail_older_cursor", () => target.client.conversation(dense.id, detailFirst.messages[0].id), (detail) => assert.deepEqual(detail.messages, detailOlder.messages), (detail) => detail.messages.length);
            const expectedStaffFirst = staffExpected(0).slice(0, 100).map((chat) => chat.id);
            await measure("staff_body_search_first", () => staffSearch(0), (page) => assert.deepEqual(page.rows.map((row) => row.id), expectedStaffFirst), (page) => page.rows.length);
            if (staffPages[0].hasMore) await measure("staff_body_search_next_cursor", () => staffSearch(0, staffPages[0].rows.at(-1)),
                (page) => assert.deepEqual(page.rows.map((row) => row.id), staffExpected(0).slice(100, 200).map((chat) => chat.id)), (page) => page.rows.length);
            else report.skippedMeasurements.push("staff_body_search_next_cursor: fixture has only one page");
            const priorUnread = expectedUnread(target), priorDenseUnread = dense.unread;
            await measure("customer_read_write_and_remaining_unread", () => target.client.markRead(dense.id, dense.publicMessages.at(-1).id, detailFirst.readRevision),
                (read) => { assert.equal(read.unread, 0); assert.equal(read.lastMessageId, dense.publicMessages.at(-1).id); }, () => 1);
            dense.unread = 0;
            await check("실제 읽음 API 이후 총 미읽음 감소량과 다른 문의 미읽음 보존", async () => {
                const page = await target.client.conversations(); assertPage(target, page);
                assert.equal(page.unreadCount, priorUnread - priorDenseUnread);
            });
            report.metrics = metrics;
            report.totalVerifiedCustomerConversations = members.reduce((sum, member) => sum + member.visible.length, 0);
            report.cleanup = config.postgres ? { mode: "helper-finally", database: database.name, confirmed: false }
                : { mode: "memory-pglite-close", confirmed: false };
        } finally {
            if (!config.postgres) {
                await pg.close(); report.cleanup = { mode: "memory-pglite-close", confirmed: true, persistedDatabase: false };
            }
        }
    }
    try {
        if (config.postgres) {
            await require("./customer-platform-test-postgres.cjs").runPostgresPlatformCheck(scenario);
            report.cleanup = { ...report.cleanup, confirmed: true, evidence: "runPostgresPlatformCheck resolved after awaited client.end(), DROP DATABASE and admin.end()" };
        } else await runPlatformCheck(scenario);
    } finally { global.fetch = originalFetch; }
}

async function main() {
    if (process.argv.includes("--help")) {
        console.log("Usage: node --import tsx scripts/check-customer-history-scale.cjs [--smoke] [--postgres] [--conversations=10000] [--messages=10] [--members=10] [--samples=10] [--max-seconds=180]\nCounts are total conversations, messages per conversation, and members per business. A dense thread adds 180-messages. Bounds: 200..20000 conversations, 10..20 messages, 2..20 members, 3..20 samples, <=200000 base messages. Time budget is checked between requests; it is not an in-flight query timeout. PostgreSQL uses only the existing validated loopback test helper.");
        return;
    }
    const started = performance.now(), config = options(process.argv.slice(2));
    const report = { kind: "customer-history-isolated-scale", status: "running", config, checks: [], metrics: [], skippedMeasurements: [],
        versions: { node: process.version, platform: process.platform, arch: process.arch,
            pglite: version(".testenv/test-runtime/node_modules/@electric-sql/pglite/package.json"), drizzle: version("node_modules/drizzle-orm/package.json"), postgresJs: version("node_modules/postgres/package.json") },
        sourceHashes: sourceHashes(), safety: { syntheticOnly: true, environmentFilesRead: false, externalHttpAllowed: false,
            database: config.postgres ? "existing helper: validated data directory, 127.0.0.1:55439, unique sendb_capacity_qa database" : "PGlite memory only" },
        interpretation: "Measured isolated API latency includes route/auth/SQL/serialization within one process. Warm caches, one client, synthetic fixtures. No network round-trip, production SLA, multi-server capacity or operational acceptance is claimed." };
    const originalLog = console.log, baseline = [];
    console.log = (...values) => { if (baseline.length < 100) baseline.push(values.map(String).join(" ")); };
    try {
        await run(config, report, started); report.status = "passed";
    } catch (error) {
        report.status = "failed"; report.error = { name: error.name, message: error.message }; process.exitCode = 1;
    } finally {
        console.log = originalLog; report.harnessLogs = baseline;
        const after = sourceHashes();
        report.sourceChangesDuringRun = after.filter((entry) => entry.sha256 !== report.sourceHashes.find((old) => old.path === entry.path)?.sha256);
        report.sourceStable = report.sourceChangesDuringRun.length === 0;
        report.elapsedMs = round(performance.now() - started);
        originalLog(JSON.stringify(report, null, 2));
    }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
