/* eslint-disable @typescript-eslint/no-require-imports -- 가상 데이터만 사용하는 격리 PostgreSQL 검사 */
// 실행: node --import tsx scripts/check-email-visit-ack.cjs (외부 네트워크·환경 파일·실제 DB 사용 없음)
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const { PGlite } = require(
    path.join(root, ".testenv/test-runtime/node_modules/@electric-sql/pglite"),
);
const { PgDialect, getTableConfig } = require("drizzle-orm/pg-core");
const { SQL } = require("drizzle-orm");
const schema = require("../src/lib/db/schema.ts");
const {
    captureVisitAcknowledgements,
    findVisitFollowupStopWithConnection,
} = require("../src/lib/email-visit-ack.ts");
const {
    deliverVisitAcknowledgement,
} = require("../src/lib/email-visit-ack-delivery.ts");
const { ensureVisitAckCopy } = require("../src/lib/email-visit-ack-copy.ts");
const copyResult = { paragraphs: ["갑작스러운 메일에도 사이트를 방문해 주셔서 감사합니다.", "살펴보시면서 더 궁금하셨던 점이 있으실까요?", "편하실 때 전화나 답장 주시면 친절히 안내하겠습니다."] };
const dialect = new PgDialect();
const org = "00000000-0000-4000-8000-000000000001",
    other = "00000000-0000-4000-8000-000000000002";
const initial = new Date("2026-10-13T05:00:00Z");
const env = {
    EMAIL_VISIT_ACK_MODE: "live",
    EMAIL_VISIT_ACK_WORKSPACE_IDS: "8,9",
    EMAIL_VISIT_ACK_START_AT: "2026-10-13T00:00:00Z",
    NODE_ENV: "production",
    NEXT_PUBLIC_BASE_URL: "https://sendb.kr",
};
function ddl(table) {
    const config = getTableConfig(table);
    const literal = (v) =>
        typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : `'${(typeof v === "string" ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
    return `CREATE TABLE "${config.name}" (${config.columns.map((c) => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${c.default === undefined ? "" : ` DEFAULT ${c.default instanceof SQL ? dialect.sqlToQuery(c.default).sql : literal(c.default)}`}`).join(",")});`;
}
async function main() {
    const pg = new PGlite();
    await pg.waitReady;
    const realFetch = global.fetch;
    global.fetch = async () => {
        throw new Error("외부 네트워크 차단");
    };
    const conn = async (strings, ...params) => {
        const query = strings.reduce(
            (s, part, i) => s + part + (i < params.length ? `$${i + 1}` : ""),
            "",
        );
        const rows = (await pg.query(query, params)).rows;
        for (const row of rows)
            if (row.data && typeof row.data === "object")
                row.data = JSON.stringify(row.data);
        return rows;
    };
    conn.release = () => {};
    const insert = async (table, data) => {
        const keys = Object.keys(data);
        return (
            await pg.query(
                `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`,
                Object.values(data),
            )
        ).rows[0];
    };
    let time = initial,
        calls = [],
        released = 0,
        result = { kind: "accepted", requestId: "fixture-request", code: "0" };
    let beforePrepare,
        beforeSendCheck,
        stopReason = null,
        checkCount = 0;
    const seed = async (id, opts = {}) => {
        const ws = opts.workspace ?? 8,
            tenant = ws === 10 ? other : org,
            email = opts.email ?? `person-${id}@example.test`,
            visitor = opts.visitor ?? id;
        const started = new Date(initial.getTime() - 1000_000),
            seconds = opts.seconds ?? 7;
        await insert("records", {
            id,
            org_id: tenant,
            workspace_id: ws,
            partition_id: ws - 7,
            data: JSON.stringify({
                email,
                contactName: "가상 담당자",
                stage: opts.stage ?? "",
            }),
        });
        await insert("email_send_logs", {
            id,
            org_id: tenant,
            partition_id: ws - 7,
            record_id: id,
            recipient_email: email,
            status: "sent",
            sent_at: new Date(started.getTime() - 600_000).toISOString(),
            subject: "가상 소개 메일",
            sender_email: "sender@example.test",
            sender_profile_id: 1,
            trigger_type: opts.triggerType ?? "ai_auto",
        });
        await insert("email_click_logs", {
            org_id: tenant,
            send_log_id: id,
            click_id: `click-${id}`,
            url: "https://fixture.test",
            clicked_at: new Date(started.getTime() - 4000).toISOString(),
            is_bot: !!opts.bot,
        });
        await pg.query(
            "INSERT INTO tracker_visitors (id,org_id,site_id,visitor_id,email) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
            [
                visitor,
                tenant,
                ws - 6,
                `visitor-${visitor}`,
                opts.identifiedEmail ?? null,
            ],
        );
        await insert("tracker_sessions", {
            id,
            visitor_id: visitor,
            site_id: ws - 6,
            session_key: `session-${id}`,
            started_at: started.toISOString(),
            ended_at:
                seconds === null
                    ? null
                    : new Date(
                          started.getTime() + seconds * 1000,
                      ).toISOString(),
            duration: opts.unknown ? null : seconds,
            page_count: 1,
            click_id: `click-${id}`,
        });
        await insert("tracker_events", {
            session_id: id,
            visitor_id: visitor,
            site_id: ws - 6,
            event_type: "PAGE_VIEW",
            page_url: "https://fixture.test/",
            occurred_at: started.toISOString(),
        });
        const q = await insert("email_followup_queue", {
            parent_log_id: id,
            source_type: opts.sourceType ?? "ai",
            source_id: 1,
            org_id: tenant,
            step_index: 0,
            check_at: initial.toISOString(),
            status: opts.status ?? "pending",
        });
        return { id, ws, email, tenant, q };
    };
    const reset = async () => {
        await pg.exec(
            "TRUNCATE email_visit_acknowledgements,email_followup_queue,email_automation_queue,email_template_links,email_click_logs,email_send_logs,tracker_events,tracker_sessions,tracker_visitors,visitor_record_links,records,email_unsubscribes,record_events,tracker_funnels RESTART IDENTITY CASCADE",
        );
        time = initial;
        calls = [];
        released = 0;
        result = { kind: "accepted", requestId: "fixture-request", code: "0" };
        beforePrepare = null;
        beforeSendCheck = null;
        stopReason = null;
        checkCount = 0;
    };
    const capture = (override = {}) =>
        captureVisitAcknowledgements(conn, {
            now: time,
            env,
            random: () => 0.5,
            ...override,
        });
    const deliver = async () => {
        const [q] = (
            await pg.query(
                "SELECT * FROM email_followup_queue WHERE source_type='visit_ack' ORDER BY id LIMIT 1",
            )
        ).rows;
        assert.ok(q, "감사 예약이 있어야 한다");
        await pg.query(
            "UPDATE email_followup_queue SET status='processing' WHERE id=$1 AND status IN ('pending','uncertain')",
            [q.id],
        );
        const outcome = await deliverVisitAcknowledgement(
            conn,
            {
                id: q.id,
                sourceId: q.source_id,
                orgId: q.org_id,
                parentLogId: q.parent_log_id,
            },
            {
                env,
                now: () => time,
                random: () => 0.5,
                timeoutMs: 20,
                checkStop: async () => {
                    checkCount++;
                    if (beforeSendCheck && checkCount === 3)
                        await beforeSendCheck();
                    return stopReason;
                },
                prepare: async (p, input) => {
                    if (beforePrepare) await beforePrepare();
                    return {
                        kind: "ready",
                        body: await ensureVisitAckCopy(conn, p, input, { generate: async () => copyResult, timeoutMs: 20 }),
                        unsubscribeToken: "fixture-only",
                        senderEmail: "sender@example.test",
                        senderProfileId: 1,
                        release: async () => {
                            released++;
                        },
                        send: async (logId) => {
                            calls.push({
                                logId,
                                parent: p.source_log_id,
                                email: p.recipient_email,
                            });
                            if (result instanceof Error) throw result;
                            if (result === "timeout")
                                return new Promise(() => {});
                            return result;
                        },
                    };
                },
            },
        );
        await pg.query(
            "UPDATE email_followup_queue SET status=$2,check_at=COALESCE($3,check_at) WHERE id=$1",
            [
                q.id,
                outcome.kind === "deferred"
                    ? "pending"
                    : outcome.kind === "skipped"
                      ? "skipped"
                      : outcome.kind,
                outcome.retryAt?.toISOString() ?? null,
            ],
        );
        return outcome;
    };
    try {
        for (const table of [
            schema.organizations,
            schema.users,
            schema.organizationMembers,
            schema.workspaces,
            schema.partitions,
            schema.records,
            schema.fieldDefinitions,
            schema.emailSenderProfiles,
            schema.emailSendLogs,
            schema.emailClickLogs,
            schema.emailFollowupQueue,
            schema.emailAutomationQueue,
            schema.emailTemplateLinks,
            schema.emailUnsubscribes,
            schema.trackerSites,
            schema.trackerSessions,
            schema.trackerVisitors,
            schema.visitorRecordLinks,
            schema.trackerEvents,
            schema.trackerEventAliases,
            schema.trackerFunnels,
            schema.recordEvents,
            schema.customerJourneyAlerts,
        ])
            await pg.exec(ddl(table));
        await pg.exec(
            "CREATE UNIQUE INDEX followup_step ON email_followup_queue(parent_log_id,step_index)",
        );
        await pg.exec(
            fs.readFileSync(
                path.join(
                    root,
                    "drizzle/0081_email_visit_acknowledgements.sql",
                ),
                "utf8",
            ),
        );
        await pg.exec(fs.readFileSync(path.join(root, "drizzle/0082_email_visit_ack_copy.sql"), "utf8"));
        await insert("organizations", {
            id: org,
            name: "가상 조직",
            slug: "fixture",
        });
        await insert("organizations", {
            id: other,
            name: "가상 다른 조직",
            slug: "other",
        });
        await insert("users", {
            org_id: org,
            email: "staff@gmail.test",
            password: "fixture",
            name: "가상 내부자",
        });
        for (const id of [8, 9, 10]) {
            const tenant = id === 10 ? other : org;
            await insert("workspaces", {
                id,
                org_id: tenant,
                name: `가상 사업 ${id}`,
            });
            await insert("partitions", {
                id: id - 7,
                workspace_id: id,
                name: "가상 명단",
            });
            await insert("tracker_sites", {
                id: id - 6,
                org_id: tenant,
                workspace_id: id,
                name: "가상 사이트",
                api_key: `fixture-${id}`,
                domains: '["fixture.test"]',
            });
            for (const [key, type] of [
                ["email", "email"],
                ["contactName", "text"],
                ["stage", "text"],
            ])
                await insert("field_definitions", {
                    workspace_id: id,
                    key,
                    label: key === "contactName" ? "담당자" : key,
                    field_type: type,
                });
        }

        await seed(100, { seconds: 6 });
        await seed(101);
        await seed(102, { unknown: true });
        await seed(103, { seconds: 5 });
        await seed(106);
        await pg.query(
            "UPDATE tracker_sessions SET ended_at=started_at+interval '6.999 seconds',duration=7 WHERE id=106",
        );
        await pg.query(
            "UPDATE tracker_sessions SET ended_at=NULL WHERE id=102",
        );
        const first = await capture();
        assert.equal(first.captured, 1);
        const queue = (
            await pg.query(
                "SELECT source_type,status,stop_reason,step_index FROM email_followup_queue ORDER BY id",
            )
        ).rows;
        assert.equal(
            queue.filter((q) => q.source_type === "visit_ack").length,
            1,
        );
        assert.equal(
            queue.find((q) => q.stop_reason === "site_visit").status,
            "cancelled",
        );
        await capture();
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_visit_acknowledgements",
                )
            ).rows[0].n,
            1,
        );
        console.log(
            "PASS 7초 경계·반올림 6.999초·측정 없음·기존 후속 즉시 중단·중복 감지·예약 1건",
        );
        time = new Date(initial.getTime() + 45 * 60_000);
        await pg.query("UPDATE email_visit_acknowledgements SET queue_id=NULL");
        assert.equal((await deliver()).kind, "sent");
        assert.equal(calls.length, 1);
        await deliver();
        assert.equal(calls.length, 1);
        const sent = (
            await pg.query(
                "SELECT * FROM email_send_logs WHERE trigger_type='visit_ack'",
            )
        ).rows;
        assert.equal(sent.length, 1);
        assert.match(sent[0].body, /가상 담당자님/);
        assert.equal(sent[0].parent_log_id, 101);
        assert.equal(sent[0].sender_email, "sender@example.test");
        console.log(
            "PASS 원본 연결·개인화 감사 문구·발신자·실제 SQL 전송 선점·재실행 1회",
        );

        await reset();
        await seed(100); await seed(101); await capture();
        const copyRows = (await pg.query("SELECT id,org_id FROM email_visit_acknowledgements ORDER BY id")).rows;
        let generations = 0;
        const copyInput = { businessName: "가상 사업", subject: "가상 소개", fields: [{ key: "contactName", label: "담당자", fieldType: "text", value: "가상 담당자" }] };
        const firstCopy = await ensureVisitAckCopy(conn, copyRows[0], copyInput, { generate: async () => { generations++; return copyResult; } });
        const cachedCopy = await ensureVisitAckCopy(conn, copyRows[0], copyInput, { generate: async () => { throw new Error("다시 생성하면 안 됨"); } });
        assert.equal(firstCopy, cachedCopy); assert.equal(generations, 1);
        await assert.rejects(ensureVisitAckCopy(conn, copyRows[1], copyInput, { generate: async () => ({ paragraphs: ["잘못된 문구"] }) }));
        await assert.rejects(ensureVisitAckCopy(conn, copyRows[1], copyInput, { generate: async () => new Promise(() => {}), timeoutMs: 10 }));
        assert.equal((await pg.query("SELECT body FROM email_visit_acknowledgements WHERE id=$1", [copyRows[1].id])).rows[0].body, null);
        assert.equal(calls.length, 0);
        console.log("PASS LLM 문구 1회 생성·DB 보존·재예약 재사용, 형식 오류·시간 초과 시 발송 없음");

        await reset();
        await seed(100, { email: "same@example.test" });
        await seed(101, { email: " SAME@example.test " });
        await seed(102, { email: "same@example.test", workspace: 9 });
        await seed(103, { workspace: 10 });
        await capture();
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_visit_acknowledgements",
                )
            ).rows[0].n,
            2,
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_followup_queue WHERE source_type='visit_ack'",
                )
            ).rows[0].n,
            2,
        );
        await insert("email_followup_queue", {
            parent_log_id: 100,
            source_type: "template",
            source_id: 2,
            org_id: org,
            step_index: 1,
            check_at: time.toISOString(),
            status: "processing",
        });
        assert.equal(
            await findVisitFollowupStopWithConnection(
                conn,
                org,
                8,
                "same@example.test",
                time,
                env,
            ),
            true,
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT status FROM email_followup_queue WHERE parent_log_id=100 AND step_index=1",
                )
            ).rows[0].status,
            "cancelled",
        );
        assert.equal(
            await findVisitFollowupStopWithConnection(
                conn,
                other,
                8,
                "same@example.test",
                time,
                env,
            ),
            false,
        );
        console.log(
            "PASS 이메일 정규화·중복 레코드 1회·두 사업 분리·다른 조직 차단·나중에 생긴 처리 중 후속 중단",
        );

        await reset();
        await seed(100, { status: "processing" });
        await seed(101, { status: "held", email: "person-100@example.test" });
        await insert("email_template_links", {
            id: 1,
            name: "가상 반복 규칙",
            partition_id: 1,
            email_template_id: 1,
            recipient_field: "email",
        });
        for (const kind of ["repeat", "first", "first_bulk"])
            await insert("email_automation_queue", {
                template_link_id: 1,
                record_id: 100,
                org_id: org,
                kind,
                next_run_at: time.toISOString(),
                status: "pending",
            });
        assert.equal(
            await findVisitFollowupStopWithConnection(
                conn,
                org,
                8,
                "person-100@example.test",
                time,
                env,
            ),
            true,
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_followup_queue WHERE source_type<>'visit_ack' AND status='cancelled'",
                )
            ).rows[0].n,
            2,
        );
        const repeat = (
            await pg.query("SELECT kind,status FROM email_automation_queue")
        ).rows;
        assert.equal(
            repeat.find((r) => r.kind === "repeat").status,
            "cancelled",
        );
        assert.ok(
            repeat
                .filter((r) => r.kind !== "repeat")
                .every((r) => r.status === "pending"),
        );
        console.log(
            "PASS 스캔 전 보내기 직전 판별·처리 중/보류 후속·반복 메일 중단, 새 첫 메일은 변경하지 않음",
        );

        await reset();
        await seed(100, { bot: true });
        await seed(101, { email: "staff@gmail.test" });
        await seed(102, { identifiedEmail: "coo@matchesplan.com" });
        await seed(103, { visitor: 500 });
        await seed(104, { visitor: 500 });
        await seed(105, { triggerType: "visit_ack" });
        await capture();
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_visit_acknowledgements WHERE status<>'ignored'",
                )
            ).rows[0].n,
            0,
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_followup_queue WHERE status='cancelled'",
                )
            ).rows[0].n,
            0,
        );
        console.log(
            "PASS 봇·내부 직원·identify 내부자·공유 브라우저·감사 메일 재클릭 제외",
        );

        await reset();
        await seed(100);
        await insert("email_unsubscribes", {
            org_id: org,
            workspace_id: 8,
            email: "person-100@example.test",
        });
        await seed(101, { stage: "구독중" });
        await insert("tracker_funnels", {
            org_id: org,
            site_id: 2,
            name: "가상 전환",
            kind: "marketing",
            is_default: 1,
            stages: JSON.stringify([
                {
                    match: {
                        type: "record_field",
                        field: "stage",
                        value: "구독중",
                    },
                },
            ]),
        });
        await capture();
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_visit_acknowledgements WHERE status='cancelled'",
                )
            ).rows[0].n,
            2,
        );
        assert.equal(calls.length, 0);
        console.log(
            "PASS 수신거부·이미 전환 완료: 후속은 중단하고 감사 발송은 제외",
        );

        await reset();
        await seed(100);
        await capture();
        time = new Date(initial.getTime() + 45 * 60_000);
        stopReason = "이미 회신";
        assert.equal((await deliver()).kind, "skipped");
        assert.equal(calls.length, 0);
        console.log("PASS 감사 메일 대기 중 회신 발생 시 발송 취소");
        await reset();
        await seed(100);
        await capture();
        time = new Date(initial.getTime() + 45 * 60_000);
        beforePrepare = () =>
            pg.query("UPDATE tracker_sessions SET duration=6 WHERE id=100");
        assert.equal((await deliver()).kind, "skipped");
        assert.equal(calls.length, 0);
        assert.equal(released, 1);
        console.log(
            "PASS 발신 준비 뒤 체류 정정: 전송 직전 재확인·발신 자리 반환",
        );
        await reset();
        await seed(100);
        await capture();
        time = new Date(initial.getTime() + 45 * 60_000);
        beforeSendCheck = async () => {
            stopReason = "보내기 직전 회신";
        };
        assert.equal((await deliver()).kind, "skipped");
        assert.equal(calls.length, 0);
        assert.equal(released, 1);
        console.log("PASS 선점 뒤 회신 발생: HTTP 전 취소·발신 자리 반환");

        await reset();
        await seed(100, { unknown: true });
        await insert("tracker_events", { session_id: 100, visitor_id: 100, site_id: 2, event_type: "CLICK", event_name: "info-open", occurred_at: new Date(initial.getTime()-999_000).toISOString() });
        assert.equal((await capture()).captured, 1);
        time = new Date(initial.getTime() + 45 * 60_000);
        beforeSendCheck = async () => {
            await pg.query("UPDATE tracker_sessions SET duration=7,ended_at=started_at+interval '6.999 seconds' WHERE id=100");
        };
        assert.equal((await deliver()).kind, "skipped");
        assert.equal(calls.length, 0);
        assert.equal(released, 1);
        assert.equal((await pg.query("SELECT status FROM email_send_logs WHERE trigger_type='visit_ack'")).rows[0].status, "cancelled");
        console.log("PASS 종료 시각만으로 7초 확인·발송 선점 이후 6.999초 정정 시 HTTP 전 취소");

        await reset();
        await seed(100);
        await capture();
        time = new Date(initial.getTime() + 45 * 60_000);
        beforePrepare = async () => {
            time = new Date("2026-10-13T09:00:01Z");
        };
        assert.equal((await deliver()).kind, "deferred");
        assert.equal(calls.length, 0);
        assert.equal(released, 1);
        console.log(
            "PASS 준비 중 업무시간 종료: 전송 직전 다시 다음 평일로 예약",
        );

        for (const failure of [
            new Error("가상 네트워크 오류"),
            "timeout",
            { kind: "uncertain" },
        ]) {
            await reset();
            await seed(100);
            await capture();
            time = new Date(initial.getTime() + 45 * 60_000);
            result = failure;
            assert.equal((await deliver()).kind, "uncertain");
            assert.equal(calls.length, 1);
            await deliver();
            assert.equal(calls.length, 1);
            assert.equal(released, 0);
        }
        console.log(
            "PASS 네트워크 오류·타임아웃·불명확 응답: 재시작·재처리에도 자동 중복 전송 0",
        );
        await reset();
        await seed(100);
        await capture();
        time = new Date(initial.getTime() + 45 * 60_000);
        result = { kind: "rejected", code: "400" };
        assert.equal((await deliver()).kind, "skipped");
        assert.equal(released, 1);
        await deliver();
        assert.equal(calls.length, 1);
        console.log(
            "PASS 확정 거절: 실패 기록·발신 자리 반환·자동 재발송 없음",
        );

        await reset();
        await seed(100);
        await capture();
        time = new Date("2026-10-13T10:00:00Z");
        let deferred = await deliver();
        assert.equal(deferred.kind, "deferred");
        assert.equal(
            deferred.retryAt.toISOString(),
            "2026-10-14T00:15:00.000Z",
        );
        assert.equal(calls.length, 0);
        time = deferred.retryAt;
        assert.equal((await deliver()).kind, "sent");
        assert.equal(calls.length, 1);
        console.log(
            "PASS 업무시간 밖은 다음 평일로 분산 예약·서버 지연 후 한꺼번에 발송하지 않음",
        );
        await reset();
        await seed(100);
        await capture();
        time = new Date(initial.getTime() + 8 * 86400_000);
        assert.equal((await deliver()).kind, "skipped");
        assert.equal(calls.length, 0);
        console.log("PASS 7일 넘게 지연된 감사 메일 취소");

        await reset();
        await seed(100);
        assert.equal(
            (
                await capture({
                    env: { ...env, EMAIL_VISIT_ACK_MODE: "dry_run" },
                })
            ).preview,
            1,
        );
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_visit_acknowledgements",
                )
            ).rows[0].n,
            0,
        );
        assert.equal(
            (await pg.query("SELECT status FROM email_followup_queue")).rows[0]
                .status,
            "pending",
        );
        assert.equal(
            (await capture({ env: { ...env, EMAIL_VISIT_ACK_MODE: "off" } }))
                .captured,
            0,
        );
        await pg.query("UPDATE email_click_logs SET clicked_at=$1", [
            "2026-10-12T23:59:00Z",
        ]);
        assert.equal((await capture()).captured, 0);
        console.log(
            "PASS dry_run·off는 후속/예약을 변경하지 않음·적용 전 과거 클릭 소급 발송 없음",
        );

        await reset();
        for (let id = 100; id < 151; id++)
            await seed(id, { email: `staff-${id}@matchesplan.com` });
        await seed(160);
        await capture();
        await capture();
        assert.equal(
            (
                await pg.query(
                    "SELECT count(*)::int AS n FROM email_visit_acknowledgements WHERE status='pending'",
                )
            ).rows[0].n,
            1,
        );
        console.log(
            "PASS 제외 대상 50명 초과 뒤 정상 고객도 다음 회차에서 처리",
        );
        await pg.exec(
            fs.readFileSync(
                path.join(
                    root,
                    "drizzle/0081_email_visit_acknowledgements.sql",
                ),
                "utf8",
            ),
        );
        const copyMigration = fs.readFileSync(path.join(root, "drizzle/0082_email_visit_ack_copy.sql"), "utf8");
        await pg.exec(copyMigration); await pg.exec(copyMigration);
        console.log("PASS 0081·0082 마이그레이션 재실행·실제 DB/외부 발송 0");
    } finally {
        global.fetch = realFetch;
        await pg.close();
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
