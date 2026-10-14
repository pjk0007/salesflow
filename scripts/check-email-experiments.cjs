/* eslint-disable @typescript-eslint/no-require-imports -- 가상 고객만 사용하는 격리 SQL 검사 */
// node --import tsx scripts/check-email-experiments.cjs
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path");
const { PGlite } = require(
    path.resolve(__dirname, "../.testenv/test-runtime/node_modules/@electric-sql/pglite"),
);
const { PgDialect, getTableConfig } = require("drizzle-orm/pg-core"),
    { SQL } = require("drizzle-orm");
const schema = require("../src/lib/db/schema.ts");
const {
    createKnowledgeVersion,
    createPolicyVersion,
    approveKnowledge,
    bindCopyVersions,
} = require("../src/lib/ai-copy/versions.ts");
const {
    approvePolicy,
    createEvaluationRun,
    processEvaluationCase,
    refreshEvaluationReport,
} = require("../src/lib/ai-copy/evaluations.ts");
const {
    createBenchmark,
    processBenchmarkCase,
    refreshBenchmark,
} = require("../src/lib/ai-copy/benchmark.ts");
const { ensureGenerationJob } = require("../src/lib/ai-copy/generation.ts");
const {
    requestCopyReplacement,
    finalizeCopyReplacement,
    cancelCopyJob,
} = require("../src/lib/ai-copy/revisions.ts");
const { attachCopyToSend, resolveCopyJob } = require("../src/lib/ai-copy/preparation.ts");
const { targetsFor } = require("../src/lib/ai-copy/rules.ts");
const {
    createExperiment,
    startExperiment,
    enrollForPreparation,
    changeExperimentState,
} = require("../src/lib/email-experiments/repository.ts");
const {
    saveExperimentContacts,
    advanceExperimentLifecycles,
    adoptExperiment,
} = require("../src/lib/email-experiments/actions.ts");
const {
    appendOutcomeRevision,
    loadExperimentResults,
} = require("../src/lib/email-experiments/results.ts");
const { previewExperiment } = require("../src/lib/email-experiments/preview.ts");
const org = "00000000-0000-4000-8000-000000000001",
    other = "00000000-0000-4000-8000-000000000002",
    user = "00000000-0000-4000-8000-000000000003";
const start = new Date("2026-09-01T01:00:00Z"),
    day = 86400000;
const dialect = new PgDialect();
function ddl(table) {
    const config = getTableConfig(table),
        literal = (v) =>
            typeof v === "boolean" || typeof v === "number"
                ? String(v)
                : `'${(typeof v === "string" ? v : JSON.stringify(v)).replaceAll("'", "''")}'`;
    return `CREATE TABLE "${config.name}" (${config.columns
        .map(
            (c) =>
                `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${c.default === undefined ? "" : ` DEFAULT ${c.default instanceof SQL ? dialect.sqlToQuery(c.default).sql : literal(c.default)}`}`,
        )
        .concat(
            config.primaryKeys.map(
                (pk) => `PRIMARY KEY(${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
            ),
        )
        .join(",")});`;
}
async function main(extraScenarios) {
    const pg = new PGlite();
    await pg.waitReady;
    const originalFetch = global.fetch;
    global.fetch = async () => {
        throw new Error("실제 네트워크 사용 금지");
    };
    const conn = async (strings, ...params) =>
        (
            await pg.query(
                strings.reduce((s, p, i) => s + p + (i < params.length ? `$${i + 1}` : ""), ""),
                params,
            )
        ).rows;
    conn.release = () => {};
    const insert = async (table, row) =>
        (
            await pg.query(
                `INSERT INTO ${table}(${Object.keys(row).join(",")}) VALUES(${Object.keys(row)
                    .map((_, i) => `$${i + 1}`)
                    .join(",")}) RETURNING *`,
                Object.values(row),
            )
        ).rows[0];
    const actor = { orgId: org, userId: user, now: start };
    let scenarios = 0;
    try {
        for (const table of [
            schema.organizations,
            schema.users,
            schema.organizationMembers,
            schema.workspaces,
            schema.partitions,
            schema.records,
            schema.products,
            schema.emailAssets,
            schema.emailAutoPersonalizedLinks,
            schema.emailSenderProfiles,
            schema.emailSendLogs,
            schema.emailReplies,
            schema.emailUnsubscribes,
            schema.aiUsageLogs,
            schema.aiUsageQuotas,
            schema.emailSendQueue,
            schema.emailPreparedSends,
            schema.emailVisitAcknowledgements,
        ])
            await pg.exec(ddl(table));
        await pg.exec("CREATE UNIQUE INDEX fixture_quota_unique ON ai_usage_quotas(org_id,month)");
        for (const name of [
            "0083_ai_copy_management.sql",
            "0084_ai_copy_benchmarks.sql",
            "0085_email_copy_experiments.sql",
            "0086_ai_copy_revisions.sql",
            "0087_copy_automation.sql",
        ])
            for (const statement of fs
                .readFileSync(path.resolve(__dirname, "../drizzle", name), "utf8")
                .split("--> statement-breakpoint"))
                if (statement.trim()) await pg.exec(statement);
        for (const [key, table] of Object.entries(schema).filter(
            ([key]) => key.startsWith("aiCopy") || key.startsWith("emailCopy"),
        )) {
            const config = getTableConfig(table);
            const columns = (
                await pg.query(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
                    [config.name],
                )
            ).rows
                .map((c) => c.column_name)
                .sort();
            assert.deepEqual(
                columns,
                config.columns.map((c) => c.name).sort(),
                `${key}: SQL와 Drizzle 컬럼 일치`,
            );
            const foreignKeys = (
                await pg.query(
                    "SELECT k.column_name,c.table_name AS foreign_table,c.column_name AS foreign_column FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON k.constraint_name=t.constraint_name AND k.constraint_schema=t.constraint_schema JOIN information_schema.constraint_column_usage c ON c.constraint_name=t.constraint_name AND c.constraint_schema=t.constraint_schema WHERE t.constraint_type='FOREIGN KEY' AND t.table_schema='public' AND t.table_name=$1",
                    [config.name],
                )
            ).rows;
            for (const fk of config.foreignKeys) {
                const ref = fk.reference();
                for (let index = 0; index < ref.columns.length; index++)
                    assert.ok(
                        foreignKeys.some(
                            (f) =>
                                f.column_name === ref.columns[index].name &&
                                f.foreign_table === getTableConfig(ref.foreignTable).name &&
                                f.foreign_column === ref.foreignColumns[index].name,
                        ),
                        `${key}.${ref.columns[index].name}: SQL와 Drizzle 참조 일치`,
                    );
            }
        }
        scenarios++;
        await insert("organizations", { id: org, name: "가상 조직", slug: "fixture" });
        await insert("organizations", { id: other, name: "다른 가상 조직", slug: "other" });
        await insert("users", {
            id: user,
            org_id: org,
            email: "owner@internal.test",
            name: "가상 관리자",
            password: "fixture-no-login",
            role: "admin",
        });
        await insert("organization_members", {
            organization_id: org,
            user_id: user,
            role: "admin",
        });
        await insert("workspaces", { id: 8, org_id: org, name: "가상 사업 A" });
        await insert("workspaces", { id: 9, org_id: org, name: "가상 사업 B" });
        await insert("partitions", { id: 1, workspace_id: 8, name: "가상 명단" });
        for (const id of [1, 2, 3])
            await insert("email_auto_personalized_links", {
                id,
                org_id: org,
                partition_id: 1,
                recipient_field: "email",
                company_field: "company",
                prompt: "가상 제품을 소개하는 첫 이메일을 작성하세요.",
                sender_profile_ids: JSON.stringify([1]),
                is_active: 1,
                is_draft: 0,
            });
        await insert("email_sender_profiles", {
            id: 1,
            org_id: org,
            name: "가상 발신",
            from_name: "가상 담당자",
            from_email: "sender@internal.test",
            daily_limit: 10,
        });
        const knowledge = await createKnowledgeVersion(conn, {
            ...actor,
            workspaceId: 8,
            name: "가상 지식",
            snapshot: { businessName: "가상 사업 A", claims: [] },
        });
        await approveKnowledge(conn, { orgId: org, id: knowledge.id, userId: user, now: start });
        const policy = {
            purpose: "initial_email",
            provider: "claude",
            model: "claude-haiku-4-5",
            parameters: { maxOutputTokens: 2048, temperature: 0.8 },
            instructions: "정중한 문장으로 간단한 질문을 적으세요.",
            requiredMeanings: ["가상 서비스 안내"],
            forbiddenPhrases: [],
            maxCharacters: 2000,
            validatorVersion: "copy-v1",
            targets: targetsFor("initial_email"),
        };
        const A = await createPolicyVersion(conn, {
            ...actor,
            workspaceId: 8,
            name: "가상 A",
            snapshot: policy,
        });
        const B = await createPolicyVersion(conn, {
            ...actor,
            workspaceId: 8,
            name: "가상 B",
            snapshot: {
                ...policy,
                instructions: "정중한 문장으로 부담을 덜 주는 질문을 적으세요.",
            },
        });
        await assert.rejects(
            approvePolicy(conn, { orgId: org, userId: user, id: A.id, now: start }),
            /평가/,
        );
        scenarios++;
        // 이 격리 검사의 승인 상태는 조건 분기를 검증하기 위한 가상 fixture다. 실제 사람 평가를 대신하지 않는다.
        await pg.exec("UPDATE ai_copy_policy_versions SET state='approved'");
        for (const ruleId of [1, 2, 3])
            await bindCopyVersions(conn, {
                ...actor,
                workspaceId: 8,
                purpose: "initial_email",
                ruleId,
                policyVersionId: A.id,
                knowledgeVersionId: knowledge.id,
            });
        const create = (ruleId, mde = 0.02) =>
            createExperiment(
                conn,
                {
                    workspaceId: 8,
                    ruleId,
                    name: `가상 실험 ${ruleId}`,
                    subject: "공통 고정 제목",
                    axis: "question",
                    hypothesis: "가상 질문 방식의 차이를 확인하는 실험입니다.",
                    policyAId: A.id,
                    policyBId: B.id,
                    knowledgeVersionId: knowledge.id,
                    baselineRate: 0.05,
                    minimumDetectableEffect: mde,
                    minimumPracticalDifference: 0.01,
                    replySource: "manual",
                    manualCollectionOwnerId: user,
                    guardrails: {
                        rejectionRate: 1,
                        unsubscribeRate: 1,
                        generationFailureRate: 1,
                        baselineNote: "가상 통계 분기 검사를 위한 허용 기준",
                    },
                },
                actor,
            );
        const experiment = await create(1);
        await startExperiment(conn, {
            ...actor,
            id: experiment.id,
            now: start,
            connectedReplyAvailable: false,
        });
        const duplicate = await create(1);
        await assert.rejects(
            startExperiment(conn, {
                ...actor,
                id: duplicate.id,
                now: start,
                connectedReplyAvailable: false,
            }),
            /진행 중/,
        );
        scenarios++;
        await saveExperimentContacts(
            conn,
            Array.from({ length: 1000 }, (_, i) => ({
                workspaceId: 8,
                email: `lead-${i}@customer.test`,
                companyKey: `회사-${i}`,
                companyVerified: true,
                verificationNote: "가상 명단의 회사 식별자 확인",
                tier: i % 2 ? "상위" : "일반",
            })),
            actor,
        );
        const enroll = (recordId, overrides = {}) =>
            enrollForPreparation(conn, {
                orgId: org,
                workspaceId: 8,
                ruleId: 1,
                recordId,
                email: `lead-${recordId}@customer.test`,
                plannedAt: start,
                senderId: 1,
                now: start,
                internal: false,
                ...overrides,
            });
        const assigned = [];
        for (let i = 0; i < 1000; i++) {
            const result = await enroll(i);
            assert.equal(result.kind, "assigned");
            assigned.push(result.assignment);
            if ((i + 1) % 250 === 0) console.log(`가상 고객 배정 ${i + 1}/1000`);
        }
        const groups = await pg.query(
            "SELECT arm,count(*)::int AS n FROM email_copy_assignments WHERE experiment_id=$1 GROUP BY arm ORDER BY arm",
            [experiment.id],
        );
        assert.deepEqual(
            groups.rows.map((g) => g.n),
            [500, 500],
        );
        scenarios++;
        const repeated = await enroll(9999, {
            email: "  LEAD-0@CUSTOMER.TEST\u200b",
            plannedAt: new Date(start.getTime() + day),
            senderId: 2,
        });
        assert.equal(repeated.assignment.id, assigned[0].id);
        assert.equal(new Date(repeated.assignment.initial_scheduled_at).getTime(), start.getTime());
        assert.equal(repeated.assignment.planned_sender_id, 1);
        scenarios++;
        await saveExperimentContacts(
            conn,
            [
                {
                    workspaceId: 8,
                    email: "colleague@customer.test",
                    companyKey: "회사-0",
                    companyVerified: true,
                    verificationNote: "가상 회사의 다른 담당자 확인",
                    tier: "상위",
                },
            ],
            actor,
        );
        assert.equal(
            (await enroll(1001, { email: "colleague@customer.test" })).reason,
            "company_representative_exists",
        );
        scenarios++;
        assert.equal(
            (await enroll(1002, { email: "owner@internal.test", internal: true })).reason,
            "internal",
        );
        scenarios++;
        const exploratory = await enroll(1003, { email: "unknown@gmail.com" });
        assert.equal(exploratory.assignment.cohort, "exploratory");
        scenarios++;
        await changeExperimentState(conn, {
            ...actor,
            id: experiment.id,
            now: start,
            action: "pause",
            pendingMode: "hold",
            reason: "가상 일시 중지 동작을 확인합니다.",
        });
        await assert.rejects(enroll(0), /보류/);
        scenarios++;
        await changeExperimentState(conn, {
            ...actor,
            id: experiment.id,
            now: start,
            action: "resume",
            pendingMode: "continue",
            reason: "가상 재개 동작을 확인합니다.",
        });
        assert.equal((await enroll(0)).assignment.arm, assigned[0].arm);
        scenarios++;
        await assert.rejects(
            pg.query("UPDATE email_copy_experiments SET config='{}'::jsonb WHERE id=$1", [
                experiment.id,
            ]),
            /새 실험/,
        );
        scenarios++;
        const result = await loadExperimentResults(conn, {
            orgId: org,
            id: experiment.id,
            asOf: new Date(start.getTime() + 20 * day),
            connectedReplyAvailable: false,
        });
        assert.equal(result.report.A.matured + result.report.B.matured, 1000);
        assert.equal(result.report.canAdopt, false);
        assert.equal(
            result.report.exploratory.A.assigned + result.report.exploratory.B.assigned,
            1,
        );
        scenarios++;
        await advanceExperimentLifecycles(conn, new Date(start.getTime() + 43 * day), org);
        assert.equal(
            (
                await pg.query("SELECT state FROM email_copy_experiments WHERE id=$1", [
                    experiment.id,
                ])
            ).rows[0].state,
            "insufficient_sample",
        );
        scenarios++;
        await assert.rejects(
            loadExperimentResults(conn, {
                orgId: other,
                id: experiment.id,
                asOf: start,
                connectedReplyAvailable: true,
            }),
            /찾을 수/,
        );
        scenarios++;
        const winning = await create(2, 0.2);
        await startExperiment(conn, {
            ...actor,
            id: winning.id,
            now: start,
            connectedReplyAvailable: false,
        });
        await saveExperimentContacts(
            conn,
            Array.from({ length: 200 }, (_, i) => ({
                workspaceId: 8,
                email: `win-${i}@customer.test`,
                companyKey: `win-company-${i}`,
                companyVerified: true,
                verificationNote: "가상 채택 시나리오 회사 확인",
                tier: "상위",
            })),
            actor,
        );
        const winRows = [];
        for (let i = 0; i < 200; i++) {
            const a = (
                await enrollForPreparation(conn, {
                    orgId: org,
                    workspaceId: 8,
                    ruleId: 2,
                    recordId: 2000 + i,
                    email: `win-${i}@customer.test`,
                    plannedAt: start,
                    senderId: 1,
                    now: start,
                    internal: false,
                })
            ).assignment;
            const log = await insert("email_send_logs", {
                org_id: org,
                partition_id: 1,
                record_id: 2000 + i,
                recipient_email: a.normalized_email,
                subject: "공통 고정 제목",
                body: "가상 접수 이메일",
                status: "sent",
                trigger_type: "ai_auto",
                auto_personalized_link_id: 2,
                sent_at: start.toISOString(),
                sender_profile_id: 1,
            });
            await pg.query(
                "UPDATE email_copy_assignments SET actual_sent_at=$1,send_log_id=$2 WHERE id=$3",
                [start.toISOString(), log.id, a.id],
            );
            winRows.push(a);
        }
        const finalTime = new Date(start.getTime() + 30 * day),
            positiveCounters = { A: 0, B: 0 };
        for (const a of winRows) {
            const limit = a.arm === "A" ? 5 : 60;
            if (positiveCounters[a.arm]++ < limit)
                await appendOutcomeRevision(
                    conn,
                    {
                        assignmentId: a.id,
                        sourceKey: `manual-${a.id}`,
                        eventType: "human_reply",
                        intent: "interested",
                        eventAt: new Date(start.getTime() + day).toISOString(),
                        emailReplyId: null,
                        evidence: "가상 고객이 서비스 자료와 상담을 요청한 회신",
                        active: true,
                    },
                    { ...actor, now: finalTime },
                );
        }
        await advanceExperimentLifecycles(conn, finalTime, org);
        const winningResult = await loadExperimentResults(conn, {
            orgId: org,
            id: winning.id,
            asOf: finalTime,
            connectedReplyAvailable: false,
        });
        assert.equal(winningResult.report.canAdopt, true);
        scenarios++;
        const changed = winRows.find((a) => a.arm === "B"),
            afterEdit = new Date(finalTime.getTime() + 60_000);
        await appendOutcomeRevision(
            conn,
            {
                assignmentId: changed.id,
                sourceKey: `manual-${changed.id}`,
                eventType: "human_reply",
                intent: "neutral",
                eventAt: new Date(start.getTime() + day).toISOString(),
                emailReplyId: null,
                evidence: "가상 회신을 다시 확인하여 중립으로 수정합니다.",
                active: true,
            },
            { ...actor, now: afterEdit },
        );
        const historic = await loadExperimentResults(conn, {
            orgId: org,
            id: winning.id,
            asOf: finalTime,
            connectedReplyAvailable: false,
        });
        const current = await loadExperimentResults(conn, {
            orgId: org,
            id: winning.id,
            asOf: afterEdit,
            connectedReplyAvailable: false,
        });
        assert.equal(historic.report.B.positive, current.report.B.positive + 1);
        scenarios++;
        await assert.rejects(
            pg.query(
                "UPDATE email_copy_outcome_revisions SET intent='interested' WHERE assignment_id=$1",
                [changed.id],
            ),
            /새 이력/,
        );
        scenarios++;
        await adoptExperiment(conn, {
            ...actor,
            id: winning.id,
            now: afterEdit,
            connectedReplyAvailable: false,
        });
        assert.equal(
            (await pg.query("SELECT policy_version_id FROM ai_copy_bindings WHERE rule_id=2"))
                .rows[0].policy_version_id,
            B.id,
        );
        assert.equal(
            (
                await pg.query("SELECT pending_mode FROM email_copy_experiments WHERE id=$1", [
                    winning.id,
                ])
            ).rows[0].pending_mode,
            "continue",
        );
        scenarios++;
        const drift = await create(3);
        await startExperiment(conn, {
            ...actor,
            id: drift.id,
            now: start,
            connectedReplyAvailable: false,
        });
        await pg.query(
            "UPDATE email_auto_personalized_links SET prompt='규칙을 변경한 가상 상황' WHERE id=3",
        );
        const invalidated = await enrollForPreparation(conn, {
            orgId: org,
            workspaceId: 8,
            ruleId: 3,
            recordId: 4000,
            email: "drift@customer.test",
            plannedAt: start,
            senderId: 1,
            now: start,
            internal: false,
        });
        assert.equal(invalidated.reason, "invalidated");
        assert.equal(
            (await pg.query("SELECT state FROM email_copy_experiments WHERE id=$1", [drift.id]))
                .rows[0].state,
            "invalidated",
        );
        scenarios++;
        const preview = await previewExperiment(conn, {
            orgId: org,
            experiment: duplicate,
            now: start,
        });
        assert.equal(preview.requiredTotal, 4426);
        assert.equal(preview.estimatedMinimumEnrollmentDays, null);
        scenarios++;
        // 아래 승인 행과 생성 결과는 기능 경계 검사용 가상 fixture다. 사람 평가·실측 근거가 아니다.
        const clone = await createPolicyVersion(conn, {
            ...actor,
            workspaceId: 8,
            name: "동일 내용 복제",
            snapshot: A.snapshot,
        });
        assert.notEqual(clone.id, A.id);
        const oldJob = await ensureGenerationJob(conn, {
            orgId: org,
            workspaceId: 8,
            purpose: "initial_email",
            key: "isolated-operation",
            policy: A.snapshot,
            knowledge: knowledge.snapshot,
            context: { system: "가상 첫 메일", user: "가상 고객", allowedUrls: [] },
        });
        await pg.query(
            "UPDATE ai_copy_generation_jobs SET state='ready',output=$2::jsonb WHERE id=$1",
            [oldJob.id, JSON.stringify({ subject: "원래 제목", htmlBody: "원래 본문" })],
        );
        const prepared = await insert("email_prepared_sends", {
            queue_id: 99001,
            link_id: 1,
            org_id: org,
            sender_profile_id: 1,
            usage_date: "2026-09-01",
            ordinal: 1,
            scheduled_at: start,
            source_hash: "fixture",
            status: "ready",
            payload: JSON.stringify({ aiCopyJobId: oldJob.id, htmlBody: "원래 본문" }),
        });
        const request = {
            ...actor,
            id: oldJob.id,
            requestId: "00000000-0000-4000-8000-000000000099",
            policyVersionId: A.id,
            knowledgeVersionId: knowledge.id,
        };
        const replacement = await requestCopyReplacement(conn, request);
        assert.equal((await requestCopyReplacement(conn, request)).id, replacement.id);
        assert.equal(
            await finalizeCopyReplacement(conn, { orgId: org, id: replacement.id }),
            false,
        );
        await assert.rejects(
            attachCopyToSend(conn, { orgId: org, jobId: oldJob.id, logId: 99999 }),
            /새 버전/,
        );
        await pg.query(
            "UPDATE ai_copy_generation_jobs SET state='ready',output=$2::jsonb WHERE id=$1",
            [replacement.id, JSON.stringify({ subject: "새 제목", htmlBody: "새 본문" })],
        );
        assert.equal(await finalizeCopyReplacement(conn, { orgId: org, id: replacement.id }), true);
        assert.equal((await resolveCopyJob(conn, org, oldJob.idempotency_key)).id, replacement.id);
        assert.equal(
            (await pg.query("SELECT payload FROM email_prepared_sends WHERE id=$1", [prepared.id]))
                .rows[0].payload,
            null,
        );
        assert.equal(
            (await pg.query("SELECT output FROM ai_copy_generation_jobs WHERE id=$1", [oldJob.id]))
                .rows[0].output.htmlBody,
            "원래 본문",
        );
        await cancelCopyJob(conn, { orgId: org, id: oldJob.id });
        await assert.rejects(
            attachCopyToSend(conn, { orgId: org, jobId: oldJob.id, logId: 99999 }),
            /작업 취소/,
        );
        scenarios += 5;
        const sentJob = await ensureGenerationJob(conn, {
            orgId: org,
            workspaceId: 8,
            purpose: "initial_email",
            key: "accepted-operation",
            policy: A.snapshot,
            knowledge: knowledge.snapshot,
            context: { system: "가상", user: "가상" },
        });
        const acceptedLog = await insert("email_send_logs", {
            org_id: org,
            recipient_email: "accepted@example.test",
            sender_email: "sender@internal.test",
            subject: "가상",
            status: "uncertain",
        });
        await pg.query(
            "UPDATE ai_copy_generation_jobs SET state='ready',send_log_id=$2 WHERE id=$1",
            [sentJob.id, acceptedLog.id],
        );
        await assert.rejects(cancelCopyJob(conn, { orgId: org, id: sentJob.id }), /발송이 시작/);
        await assert.rejects(
            requestCopyReplacement(conn, {
                ...request,
                id: sentJob.id,
                requestId: "00000000-0000-4000-8000-000000000098",
            }),
            /발송이 시작/,
        );
        scenarios++;
        const knowledge9 = await createKnowledgeVersion(conn, {
            ...actor,
            workspaceId: 9,
            name: "가상 두 번째 사업 지식",
            snapshot: { businessName: "가상 사업 B", claims: [] },
        });
        await approveKnowledge(conn, { ...actor, id: knowledge9.id });
        const A9 = await createPolicyVersion(conn, {
            ...actor,
            workspaceId: 9,
            name: "가상 A9",
            snapshot: A.snapshot,
        });
        const B9 = await createPolicyVersion(conn, {
            ...actor,
            workspaceId: 9,
            name: "가상 B9",
            snapshot: B.snapshot,
        });
        const evaluation = await createEvaluationRun(conn, {
            ...actor,
            purpose: "initial_email",
            pairs: [
                {
                    workspaceId: 8,
                    baselinePolicyId: A.id,
                    candidatePolicyId: clone.id,
                    knowledgeVersionId: knowledge.id,
                },
                {
                    workspaceId: 9,
                    baselinePolicyId: A9.id,
                    candidatePolicyId: B9.id,
                    knowledgeVersionId: knowledge9.id,
                },
            ],
        });
        const evalCases = (
            await pg.query("SELECT * FROM ai_copy_evaluation_cases WHERE run_id=$1 ORDER BY id", [
                evaluation.id,
            ])
        ).rows;
        assert.equal(evalCases.length, 400);
        assert.equal(evalCases.filter((c) => c.review_required).length, 80);
        const fakeDeps = {
            now: () => start,
            quota: async () => true,
            call: async () => ({
                content: JSON.stringify({
                    subject: "가상 제목",
                    htmlBody: "<p>가상 서비스를 안내드립니다. 추가로 궁금하신 점이 있으실까요?</p>",
                }),
                promptTokens: 100,
                completionTokens: 50,
                truncated: false,
            }),
        };
        await processEvaluationCase(conn, { orgId: org, caseId: evalCases[0].id }, fakeDeps);
        const template = (
            await pg.query(
                "SELECT j.* FROM ai_copy_generation_jobs j JOIN ai_copy_evaluation_cases c ON c.job_id=j.id WHERE c.id=$1",
                [evalCases[0].id],
            )
        ).rows[0];
        assert.equal(template.origin, "evaluation");
        assert.equal(template.state, "ready");
        for (const c of evalCases.slice(1)) {
            const p =
                c.policy_version_id === clone.id
                    ? clone
                    : c.policy_version_id === A9.id
                      ? A9
                      : c.policy_version_id === B9.id
                        ? B9
                        : A;
            const j = await ensureGenerationJob(conn, {
                orgId: org,
                workspaceId: c.workspace_id,
                purpose: "initial_email",
                key: `evaluation:${evaluation.id}:${c.id}`,
                policyVersionId: p.id,
                knowledgeVersionId: c.workspace_id === 8 ? knowledge.id : knowledge9.id,
                policy: p.snapshot,
                knowledge: c.workspace_id === 8 ? knowledge.snapshot : knowledge9.snapshot,
                context: {
                    system: "가상 사례",
                    user: JSON.stringify({ virtualCustomer: `가상 ${c.id}` }),
                    allowedUrls: [],
                },
                eligibleAt: start,
            });
            await pg.query(
                "UPDATE ai_copy_generation_jobs SET state='ready',ready_at=$2,output=$3::jsonb WHERE id=$1",
                [
                    j.id,
                    start,
                    JSON.stringify({
                        ...template.output,
                        fingerprint: `fixture-${c.id}`,
                        question: `가상 질문 ${c.id}?`,
                    }),
                ],
            );
            await pg.query("UPDATE ai_copy_evaluation_cases SET job_id=$2 WHERE id=$1", [
                c.id,
                j.id,
            ]);
        }
        const evalReport = await refreshEvaluationReport(conn, org, evaluation.id);
        assert.equal(evalReport.validCases, 400);
        assert.equal(evalReport.missingReviews, 80);
        assert.equal(evalReport.passed, false);
        await assert.rejects(approvePolicy(conn, { ...actor, id: clone.id }), /평가|사용량|성능/);
        const benchmark = await createBenchmark(conn, {
            ...actor,
            runId: evaluation.id,
            region: "isolated fixture",
        });
        assert.equal(benchmark.scheduledSamples, 630);
        assert.equal(benchmark.hardware.smtpCalls, 0);
        const benchCase = (
            await pg.query(
                "SELECT id FROM ai_copy_benchmark_cases WHERE run_id=$1 ORDER BY id LIMIT 1",
                [benchmark.id],
            )
        ).rows[0];
        await processBenchmarkCase(conn, { orgId: org, caseId: benchCase.id }, fakeDeps);
        assert.equal((await refreshBenchmark(conn, org, benchmark.id)).state, "running");
        scenarios += 4;
        // 실제 API 핸들러를 격리 연결과 가상 인증으로 실행한다.
        const Module = require("node:module"),
            originalLoad = Module._load;
        Module._load = function (name, parent, isMain) {
            const resolved = Module._resolveFilename(name, parent, isMain).replaceAll("\\", "/");
            if (resolved.endsWith("/src/lib/db/index.ts"))
                return { queryClient: { reserve: async () => conn } };
            if (resolved.endsWith("/src/lib/auth.ts"))
                return {
                    getUserFromNextRequest: (req) =>
                        req.headers.get("x-fixture-role") === "anonymous"
                            ? null
                            : {
                                  userId: user,
                                  orgId: org,
                                  role: req.headers.get("x-fixture-role") || "admin",
                              },
                };
            return originalLoad.apply(this, arguments);
        };
        try {
            const { NextRequest } = require("next/server");
            for (const endpoint of [
                "ai/copy-policies",
                "ai/copy-binding-history",
                "ai/knowledge-versions",
                "ai/copy-prices",
                "ai/generations",
                "ai/copy-evaluations",
                "ai/copy-automation",
                "email/experiments",
                "email/experiments/contacts",
            ]) {
                const route = require(`../src/app/api/${endpoint}/route.ts`);
                for (const [role, expected] of [
                    ["anonymous", 401],
                    ["member", 403],
                    ["admin", 200],
                ]) {
                    const response = await route.GET(
                        new NextRequest(`http://isolated.test/api/${endpoint}?workspaceId=8`, {
                            headers: { "x-fixture-role": role },
                        }),
                    );
                    assert.equal(
                        response.status,
                        expected,
                        `${endpoint}: ${JSON.stringify(await response.json())}`,
                    );
                }
            }
            const reviewRoute = require("../src/app/api/ai/copy-evaluations/[id]/reviews/route.ts");
            const reviewContext = { params: Promise.resolve({ id: String(evaluation.id) }) };
            const reviewUrl = `http://isolated.test/api/ai/copy-evaluations/${evaluation.id}/reviews`;
            const blindResponse = await reviewRoute.GET(new NextRequest(reviewUrl), reviewContext);
            const blind = await blindResponse.json();
            assert.equal(blind.data.cases.length, 80);
            assert.ok(
                blind.data.cases.every(
                    (c) => !("policy_version_id" in c) && c.other_reviews.length === 0,
                ),
            );
            const reviewBody = {
                caseId: blind.data.cases[0].id,
                naturalness: 4,
                factuality: 4,
                purposeFit: 4,
                criticalError: false,
                notes: "격리 SQL 기능 검사 fixture",
            };
            const postReview = () =>
                reviewRoute.POST(
                    new NextRequest(reviewUrl, {
                        method: "POST",
                        body: JSON.stringify(reviewBody),
                        headers: { "content-type": "application/json" },
                    }),
                    reviewContext,
                );
            assert.equal((await postReview()).status, 200);
            assert.equal((await postReview()).status, 400);
            assert.equal((await refreshEvaluationReport(conn, org, evaluation.id)).passed, false);
            scenarios++;
        } finally {
            Module._load = originalLoad;
        }
        scenarios++;
        await pg.query("UPDATE ai_copy_generation_jobs SET assignment_id=$2 WHERE id=$1", [
            sentJob.id,
            changed.id,
        ]);
        await pg.query(
            "UPDATE email_copy_experiments SET state='paused',pending_mode='hold' WHERE id=$1",
            [winning.id],
        );
        await assert.rejects(
            attachCopyToSend(conn, { orgId: org, jobId: sentJob.id, logId: acceptedLog.id }),
            /실험 미발송 보류/,
        );
        await pg.query(
            "UPDATE email_copy_experiments SET state='closed',pending_mode='continue' WHERE id=$1",
            [winning.id],
        );
        const bindingEvents = (
            await pg.query("SELECT * FROM ai_copy_binding_events WHERE rule_id=2 ORDER BY id")
        ).rows;
        assert.equal(bindingEvents.at(-1).previous_policy_id, A.id);
        assert.equal(bindingEvents.at(-1).policy_version_id, B.id);
        scenarios += 2;
        // 평소 발송 자동 관찰은 실제 발송·외부 호출 없이 로컬 장부만 읽는다.
        const { loadCopyObservations } = require("../src/lib/ai-copy/observations.ts");
        const observationAt = new Date("2026-10-15T01:00:00Z");
        const normalLog = await insert("email_send_logs", {
            org_id: org, partition_id: 1, recipient_email: "baseline@outside.test",
            status: "sent", sent_at: new Date("2026-10-01T01:00:00Z"), auto_personalized_link_id: 2,
        });
        const normalJob = await ensureGenerationJob(conn, {
            orgId: org, workspaceId: 8, purpose: "initial_email", key: "initial:2:999:normal-observation",
            policy: A.snapshot, knowledge: knowledge.snapshot, context: { system: "가상 지침", user: "가상 고객" },
        });
        await pg.query("UPDATE ai_copy_generation_jobs SET send_log_id=$2,created_at='2026-10-01T01:00:00Z',eligible_at='2026-10-01T01:00:00Z',ready_at='2026-10-01T01:00:10Z',state='ready',output=$3::jsonb WHERE id=$1", [normalJob.id,normalLog.id,JSON.stringify({subject:"가상 첫 메일",htmlBody:"가상 본문",fingerprint:"ordinary",question:"어떤가요?"})]);
        await insert("email_replies", {
            org_id: org, workspace_id: 8, root_log_id: normalLog.id, send_log_id: normalLog.id,
            mailbox: "demo@internal.test", gmail_message_id: "ordinary-human-reply", from_email: "baseline@outside.test",
            to_email: "demo@internal.test", contact_email: "baseline@outside.test", kind: "human", ours_reason: "address",
            match_status: "matched", received_at: new Date("2026-10-02T01:00:00Z"), detected_at: new Date("2026-10-02T01:00:00Z"), detected_mode: "on",
        });
        const priorReplyMode = process.env.REPLY_SYNC_MODE;
        process.env.REPLY_SYNC_MODE = "off";
        let observations;
        try {
            observations = await loadCopyObservations(conn, { orgId: org, workspaceId: 8, days: 30, now: observationAt, internalDomains: ["internal.test"] });
            const ordinary = observations.groups.find(g=>g.ruleId===2 && g.policyId===null);
            assert.equal(ordinary.sent,1);
            assert.equal(ordinary.matured,1);
            assert.equal(ordinary.humanReplies,1);
            assert.equal(ordinary.replyConnected,false);
            assert.ok(observations.purposes[0].jobs>0);
            assert.equal((await loadCopyObservations(conn, {orgId:org,workspaceId:999,days:30,now:observationAt})).observedJobs,0);
        } finally {
            if(priorReplyMode===undefined) delete process.env.REPLY_SYNC_MODE; else process.env.REPLY_SYNC_MODE=priorReplyMode;
        }
        scenarios += 2;
        if(extraScenarios)await extraScenarios({pg,conn,org,user,A,B,knowledge,winning,insert,schema});
        const catalog = {
            // 아래 UI fixture 역시 실제 운영·품질 실측 근거로 사용하지 않는다.
            versions: (await pg.query("SELECT * FROM ai_copy_policy_versions ORDER BY id")).rows,
            workspaces: [
                { id: 8, name: "가상 사업 A" },
                { id: 9, name: "가상 사업 B" },
            ],
            rules: [{ id: 1, name: "가상 첫 메일", workspace_id: 8 }],
            bindings: (await pg.query("SELECT * FROM ai_copy_bindings")).rows,
            nextCursor: null,
        };
        const experiments = (await pg.query("SELECT * FROM email_copy_experiments ORDER BY id"))
            .rows;
        const fixture = {
            catalog,
            knowledge: {
                versions: (await pg.query("SELECT * FROM ai_copy_knowledge_versions")).rows,
                nextCursor: null,
            },
            experiments,
            result: current,
            preview,
            assignments: (
                await pg.query(
                    "SELECT a.*,0 AS human_replies,'held' AS generation_state FROM email_copy_assignments a WHERE experiment_id=$1 ORDER BY id LIMIT 10",
                    [winning.id],
                )
            ).rows,
            evaluation: {
                id: evaluation.id,
                purpose: "initial_email",
                state: "review",
                pairs: [],
                report: evalReport,
                created_at: start,
            },
            job: {
                ...oldJob,
                state: "held",
                origin: "operational",
                reason: "문구 검토 대기",
                cost_known: false,
                cost_krw: null,
            },
        };
        fs.writeFileSync(
            path.resolve(__dirname, "../.testenv/copy-ui-fixture.json"),
            JSON.stringify(fixture),
        );
        await pg.query("DELETE FROM email_auto_personalized_links WHERE id=1");
        assert.equal(
            (await pg.query("SELECT state FROM email_copy_experiments WHERE id=$1", [duplicate.id]))
                .rows[0].state,
            "invalidated",
        );
        assert.equal(
            (await pg.query("SELECT count(*)::int AS n FROM ai_copy_bindings WHERE rule_id=1"))
                .rows[0].n,
            0,
        );
        scenarios++;
        console.log(
            JSON.stringify({
                passed: true,
                scenarios,
                virtualAssignments: 1201,
                actualCustomerSends: 0,
                externalNetwork: false,
                humanQualityEvaluation: "not performed; approval rows are isolated fixtures",
            }),
        );
    } finally {
        global.fetch = originalFetch;
        await pg.close();
    }
}
module.exports.runCheck=main;
if(require.main===module)main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
