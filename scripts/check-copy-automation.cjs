/* eslint-disable @typescript-eslint/no-require-imports -- 외부 호출 없는 격리 PostgreSQL 검사 */
// node --import tsx scripts/check-copy-automation.cjs
const assert = require("node:assert/strict");
const { getTableConfig } = require("drizzle-orm/pg-core");
const { runCheck } = require("./check-email-experiments.cjs");
const {
    configureCopyAutomation,
    createAutomationCycle,
    advanceAutomation,
    prepareAutomaticExperiment,
    applyAutomationCycle,
} = require("../src/lib/ai-copy/automation.ts");
const { bindCopyVersions, createPolicyVersion } = require("../src/lib/ai-copy/versions.ts");
const {
    startExperiment,
    enrollForPreparation,
} = require("../src/lib/email-experiments/repository.ts");
const { advanceExperimentLifecycles } = require("../src/lib/email-experiments/actions.ts");
const { appendOutcomeRevision } = require("../src/lib/email-experiments/results.ts");
const {
    requireAutomaticBudget,
    callAutomationTask,
} = require("../src/lib/ai-copy/automation-calls.ts");

runCheck(async ({ pg, conn, org, user, A, knowledge, insert, schema }) => {
    let scenarios = 0,
        calls = 0,
        generated = 0,
        clock = new Date();
    const score = {
        naturalness: 4,
        factuality: 5,
        purposeFit: 4,
        criticalError: false,
        unsupportedClaim: false,
        notes: "격리 시연용 합성 검토 점수입니다.",
    };
    let failReview = false;
    const deps = {
        now: () => new Date(clock),
        quota: async () => true,
        call: async (policy, prompt) => {
            calls++;
            clock = new Date(clock.getTime() + 10);
            let data;
            try {
                data = JSON.parse(prompt.user);
            } catch {
                data = {};
            }
            const result = (content, promptTokens = 100, completionTokens = 50) => ({
                content: JSON.stringify(content),
                promptTokens,
                completionTokens,
                truncated: false,
            });
            if (data.currentInstructions)
                return result({
                    instructions:
                        "방문과 서비스 소개의 기존 의미는 유지하되, 짧고 부담 없는 질문 하나를 고객마다 다르게 표현하세요. " +
                        calls,
                    reason: "가상 테스트에서 질문 방식 한 항목만 다르게 비교하는 후보입니다.",
                });
            if (data.left)
                return result({
                    left: { ...score },
                    right: { ...score, unsupportedClaim: failReview },
                });
            if (data.excerpt)
                return result({
                    intent: data.excerpt.includes("자료") ? "interested" : "neutral",
                    confidence: 0.99,
                    quote: data.excerpt,
                    reason: "합성 회신 원문에 나타난 요청을 분류했습니다.",
                });
            generated++;
            return result(
                policy.purpose === "visit_ack"
                    ? {
                          paragraphs: [
                              "갑작스런 메일에도 방문해 주셔서 감사합니다.",
                              `검토하신 내용 중 ${String.fromCodePoint(0xac00 + generated)} 항목에 더 궁금한 점이 있으실까요?`,
                              "언제든 전화나 답장 주시면 친절히 안내드리겠습니다.",
                          ],
                      }
                    : {
                          subject: "가상 서비스 소개",
                          htmlBody: `<p>안녕하세요. 가상 서비스 소개입니다.</p><p>${generated}번째 가상 고객의 문의가 있으실까요?</p>`,
                      },
                1000,
                200,
            );
        },
    };
    const fresh = async (id) =>
        (await pg.query("SELECT * FROM ai_copy_automation_cycles WHERE id=$1", [id])).rows[0];
    const originalHumanReviews = (
        await pg.query("SELECT count(*)::int AS n FROM ai_copy_human_reviews")
    ).rows[0].n;
    const actor = () => ({ orgId: org, userId: user, now: new Date(clock) });
    for (const table of [
        schema.aiCopyAutomationSettings,
        schema.aiCopyAutomationCycles,
        schema.aiCopyAutomationSamples,
        schema.aiCopyAutomationCalls,
    ]) {
        const c = getTableConfig(table),
            actual = (
                await pg.query(
                    "SELECT column_name FROM information_schema.columns WHERE table_name=$1",
                    [c.name],
                )
            ).rows
                .map((r) => r.column_name)
                .sort();
        assert.deepEqual(actual, c.columns.map((c) => c.name).sort());
    }
    scenarios++;
    await pg.query(
        "INSERT INTO email_auto_personalized_links(id,org_id,partition_id,name,recipient_field,company_field,prompt,sender_profile_ids,is_active,is_draft) VALUES(4,$1,1,'자동 준비 가상 규칙','email','company','제품을 자연스럽게 소개해 주세요.','[1]'::jsonb,1,0)",
        [org],
    );
    await bindCopyVersions(conn, {
        orgId: org,
        userId: user,
        workspaceId: 8,
        purpose: "initial_email",
        ruleId: 4,
        policyVersionId: A.id,
        knowledgeVersionId: knowledge.id,
    });
    await configureCopyAutomation(
        conn,
        { workspaceId: 8, enabled: true, experimentMode: "manual" },
        actor(),
    );
    const setting = (
        await pg.query(
            "SELECT * FROM ai_copy_automation_settings WHERE rule_id=4 AND purpose='initial_email'",
        )
    ).rows[0];
    let cycle = await createAutomationCycle(conn, setting, clock);
    await assert.rejects(() => applyAutomationCycle(conn, cycle, actor(), true), /적용 대기/);
    scenarios++;
    await advanceAutomation(conn, setting, cycle, deps, true);
    cycle = await fresh(cycle.id);
    const initialCalls = calls;
    await callAutomationTask(
        conn,
        {
            orgId: org,
            workspaceId: 8,
            cycleId: cycle.id,
            key: "candidate",
            kind: "candidate",
            policy: A.snapshot,
            prompt: { system: "가상 작업", user: "{}" },
        },
        deps,
    );
    assert.equal(calls, initialCalls);
    scenarios++;
    for (let i = 0; i < 80; i++) {
        cycle = await fresh(cycle.id);
        if (cycle.stage === "ready_for_experiment") break;
        await advanceAutomation(conn, setting, cycle, deps, true);
    }
    cycle = await fresh(cycle.id);
    assert.equal(cycle.stage, "ready_for_experiment");
    assert.equal(cycle.report.passed, true);
    assert.equal(cycle.report.humanReview, false);
    assert.equal(cycle.report.controlledLoad, false);
    const candidate = (
        await pg.query("SELECT * FROM ai_copy_policy_versions WHERE id=$1", [
            cycle.candidate_policy_id,
        ])
    ).rows[0];
    assert.equal(candidate.approval_method, "automatic_evaluation");
    assert.equal(
        (await pg.query("SELECT count(*)::int AS n FROM ai_copy_human_reviews")).rows[0].n,
        originalHumanReviews,
    );
    scenarios++;
    await advanceAutomation(conn, setting, cycle, deps, true);
    assert.equal((await fresh(cycle.id)).experiment_id, null);
    assert.equal(
        (await pg.query("SELECT policy_version_id FROM ai_copy_bindings WHERE rule_id=4")).rows[0]
            .policy_version_id,
        A.id,
    );
    scenarios++;
    await pg.query(
        "INSERT INTO records(id,org_id,workspace_id,partition_id,data) SELECT 50000+i,$1,8,1,jsonb_build_object('email','auto-'||i||'@outside.test','company','자동 가상회사 '||i,'name','가상 담당자') FROM generate_series(0,999) i",
        [org],
    );
    await pg.query(
        "INSERT INTO email_send_queue(record_id,partition_id,org_id,trigger_type,status) SELECT 50000+i,1,$1,'on_create','pending' FROM generate_series(0,999)i",
        [org],
    );
    const manualDraft = await prepareAutomaticExperiment(conn, cycle, clock, false, false);
    assert.equal(
        (
            await pg.query("SELECT state FROM email_copy_experiments WHERE id=$1", [
                manualDraft.experimentId,
            ])
        ).rows[0].state,
        "draft",
    );
    assert.ok(
        (
            await pg.query("SELECT config FROM email_copy_experiments WHERE id=$1", [
                manualDraft.experimentId,
            ])
        ).rows[0].config.plannedPerArm <= 210,
    );
    scenarios++;
    await startExperiment(conn, {
        ...actor(),
        id: manualDraft.experimentId,
        connectedReplyAvailable: true,
    });
    await advanceAutomation(conn, setting, await fresh(cycle.id), deps, true);
    cycle = await fresh(cycle.id);
    assert.equal(cycle.stage, "experimenting");
    const config = (
        await pg.query("SELECT config FROM email_copy_experiments WHERE id=$1", [
            cycle.experiment_id,
        ])
    ).rows[0].config;
    const at = new Date(clock);
    for (let i = 0; i < config.plannedPerArm * 2; i++) {
        const enrolled = await enrollForPreparation(conn, {
            orgId: org,
            workspaceId: 8,
            ruleId: 4,
            recordId: 50000 + i,
            email: `auto-${i}@outside.test`,
            plannedAt: at,
            senderId: 1,
            senderEmail: "demo@internal.test",
            now: at,
            internal: false,
        });
        assert.equal(enrolled.kind, "assigned");
        const a = enrolled.assignment;
        // 발송·생성 이력을 가정한 합성 데이터. SMTP나 고객 통신을 호출하지 않는다.
        const log = await insert("email_send_logs", {
            org_id: org,
            partition_id: 1,
            recipient_email: a.normalized_email,
            status: "sent",
            sent_at: at,
            auto_personalized_link_id: 4,
        });
        const job = (
            await pg.query(
                "INSERT INTO ai_copy_generation_jobs(org_id,workspace_id,purpose,idempotency_key,policy_snapshot,context,state,ready_at,eligible_at,assignment_id,send_log_id) VALUES($1,8,'initial_email',$2,$3::jsonb,'{}'::jsonb,'ready',$4,$4,$5,$6) RETURNING id",
                [
                    org,
                    `experiment-assignment:${a.id}`,
                    JSON.stringify(A.snapshot),
                    at,
                    a.id,
                    log.id,
                ],
            )
        ).rows[0];
        await pg.query(
            "UPDATE email_copy_assignments SET generation_job_id=$2,send_log_id=$3,actual_sent_at=$4 WHERE id=$1",
            [a.id, job.id, log.id, at],
        );
        const previous = (
            await pg.query(
                "SELECT count(*)::int AS n FROM email_replies r JOIN email_copy_assignments a ON a.send_log_id=r.root_log_id WHERE a.experiment_id=$1 AND a.arm=$2",
                [cycle.experiment_id, a.arm],
            )
        ).rows[0].n;
        if (previous < (a.arm === "A" ? 8 : 100))
            await insert("email_replies", {
                org_id: org,
                workspace_id: 8,
                root_log_id: log.id,
                send_log_id: log.id,
                mailbox: "demo@internal.test",
                gmail_message_id: `auto-reply-${i}`,
                from_email: a.normalized_email,
                to_email: "demo@internal.test",
                contact_email: a.normalized_email,
                kind: "human",
                ours_reason: "address",
                match_status: "matched",
                received_at: new Date(at.getTime() + 86400000),
                detected_at: new Date(at.getTime() + 86400000),
                detected_mode: "on",
                excerpt: "서비스 자료를 보내주실 수 있나요?",
            });
    }
    clock = new Date(at.getTime() + 30 * 86400000);
    await advanceExperimentLifecycles(conn, clock, org);
    for (let i = 0; i < 45; i++)
        await advanceAutomation(conn, setting, await fresh(cycle.id), deps, true);
    cycle = await fresh(cycle.id);
    assert.equal(cycle.stage, "awaiting_application");
    assert.equal(
        (await pg.query("SELECT policy_version_id FROM ai_copy_bindings WHERE rule_id=4")).rows[0]
            .policy_version_id,
        A.id,
    );
    scenarios++;
    const first = (
        await pg.query(
            "SELECT o.* FROM email_copy_outcome_revisions o JOIN email_copy_assignments a ON a.id=o.assignment_id WHERE a.experiment_id=$1 AND o.source_method='automatic_classifier' ORDER BY o.id LIMIT 1",
            [cycle.experiment_id],
        )
    ).rows[0];
    assert.ok(first);
    assert.equal(first.intent, "interested");
    await appendOutcomeRevision(
        conn,
        {
            assignmentId: first.assignment_id,
            sourceKey: first.source_key,
            eventType: "human_reply",
            intent: "neutral",
            eventAt: new Date(first.event_at).toISOString(),
            emailReplyId: first.email_reply_id,
            evidence: "관리자가 원문을 확인해 단순 감사 인사로 정정한 합성 사례입니다.",
            active: true,
        },
        actor(),
    );
    const ignored = await appendOutcomeRevision(
        conn,
        {
            assignmentId: first.assignment_id,
            sourceKey: first.source_key,
            eventType: "human_reply",
            intent: "interested",
            eventAt: new Date(first.event_at).toISOString(),
            emailReplyId: first.email_reply_id,
            evidence: "뒤늦은 자동 처리 결과가 사람의 정정을 덮어쓰면 안 됩니다.",
            active: true,
        },
        { ...actor(), sourceMethod: "automatic_classifier", confidence: 1 },
    );
    assert.equal(ignored.unchanged, true);
    scenarios++;
    await advanceAutomation(conn, setting, await fresh(cycle.id), deps, true);
    assert.equal(
        (await pg.query("SELECT policy_version_id FROM ai_copy_bindings WHERE rule_id=4")).rows[0]
            .policy_version_id,
        A.id,
    );
    await applyAutomationCycle(conn, await fresh(cycle.id), actor(), true);
    assert.equal(
        (await pg.query("SELECT policy_version_id FROM ai_copy_bindings WHERE rule_id=4")).rows[0]
            .policy_version_id,
        cycle.candidate_policy_id,
    );
    assert.equal((await fresh(cycle.id)).applied_by, user);
    scenarios++;
    clock = new Date(clock.getTime() + 86400000);
    const ackSetting = (
        await pg.query(
            "SELECT * FROM ai_copy_automation_settings WHERE purpose='visit_ack' AND workspace_id=8",
        )
    ).rows[0];
    let ack = await createAutomationCycle(conn, ackSetting, clock);
    for (let i = 0; i < 85; i++) {
        ack = await fresh(ack.id);
        if (ack.stage === "awaiting_application") break;
        await advanceAutomation(conn, ackSetting, ack, deps, false);
    }
    ack = await fresh(ack.id);
    assert.equal(ack.stage, "awaiting_application");
    assert.equal(
        (
            await pg.query(
                "SELECT count(*)::int AS n FROM ai_copy_bindings WHERE purpose='visit_ack' AND workspace_id=8",
            )
        ).rows[0].n,
        0,
    );
    const interrupted = Object.assign(async (sql, ...values) => {
        if (sql.join("").includes("SET stage='applied'"))
            throw new Error("합성 장애: 상태 저장 실패");
        return conn(sql, ...values);
    }, conn);
    await assert.rejects(() => applyAutomationCycle(interrupted, ack, actor(), false), /합성 장애/);
    assert.equal(
        (
            await pg.query(
                "SELECT count(*)::int AS n FROM ai_copy_bindings WHERE purpose='visit_ack' AND workspace_id=8",
            )
        ).rows[0].n,
        0,
    );
    assert.equal((await fresh(ack.id)).stage, "awaiting_application");
    scenarios++;
    await applyAutomationCycle(conn, ack, actor(), false);
    assert.equal(
        (
            await pg.query(
                "SELECT policy_version_id FROM ai_copy_bindings WHERE purpose='visit_ack' AND workspace_id=8",
            )
        ).rows[0].policy_version_id,
        ack.candidate_policy_id,
    );
    scenarios++;
    await assert.rejects(
        () => requireAutomaticBudget(conn, org, clock, { ...deps, quota: async () => false }),
        /사용량 한도/,
    );
    scenarios++;
    clock = new Date(clock.getTime() + 86400000);
    failReview = true;
    let failed = await createAutomationCycle(conn, ackSetting, clock);
    for (let i = 0; i < 85; i++) {
        failed = await fresh(failed.id);
        if (failed.stage === "blocked") break;
        await advanceAutomation(conn, ackSetting, failed, deps, false);
    }
    failed = await fresh(failed.id);
    assert.equal(failed.stage, "blocked");
    assert.equal(
        (
            await pg.query(
                "SELECT policy_version_id FROM ai_copy_bindings WHERE purpose='visit_ack' AND workspace_id=8",
            )
        ).rows[0].policy_version_id,
        ack.candidate_policy_id,
    );
    scenarios++;
    await pg.query(
        "INSERT INTO email_auto_personalized_links(id,org_id,partition_id,name,recipient_field,company_field,prompt,sender_profile_ids,is_active,is_draft) VALUES(5,$1,1,'자동 개설 검증 규칙','email','company','제품을 자연스럽게 소개해 주세요.','[1]'::jsonb,1,0)",
        [org],
    );
    await bindCopyVersions(conn, {
        orgId: org,
        userId: user,
        workspaceId: 8,
        purpose: "initial_email",
        ruleId: 5,
        policyVersionId: A.id,
        knowledgeVersionId: knowledge.id,
    });
    await configureCopyAutomation(
        conn,
        { workspaceId: 8, enabled: true, experimentMode: "auto" },
        actor(),
    );
    const autoSetting = (
        await pg.query(
            "SELECT * FROM ai_copy_automation_settings WHERE rule_id=5 AND purpose='initial_email'",
        )
    ).rows[0];
    let autoCycle = await createAutomationCycle(conn, autoSetting, clock);
    await pg.query(
        "UPDATE ai_copy_automation_cycles SET candidate_policy_id=$2,stage='ready_for_experiment' WHERE id=$1",
        [autoCycle.id, cycle.candidate_policy_id],
    );
    await advanceAutomation(conn, autoSetting, await fresh(autoCycle.id), deps, true);
    autoCycle = await fresh(autoCycle.id);
    assert.equal(autoCycle.stage, "experimenting");
    assert.equal(autoCycle.experiment_owned, true);
    assert.equal(
        (
            await pg.query("SELECT state FROM email_copy_experiments WHERE id=$1", [
                autoCycle.experiment_id,
            ])
        ).rows[0].state,
        "running",
    );
    assert.equal(
        (await pg.query("SELECT policy_version_id FROM ai_copy_bindings WHERE rule_id=5")).rows[0]
            .policy_version_id,
        A.id,
    );
    scenarios++;
    await pg.query(
        "INSERT INTO email_auto_personalized_links(id,org_id,partition_id,name,recipient_field,company_field,prompt,sender_profile_ids,is_active,is_draft) VALUES(6,$1,1,'전체 연결 없는 규칙 검증','email','company','제품을 자연스럽게 소개해 주세요.','[1]'::jsonb,1,0)",
        [org],
    );
    await configureCopyAutomation(
        conn,
        { workspaceId: 8, enabled: true, experimentMode: "auto" },
        actor(),
    );
    const unboundSetting = (
        await pg.query(
            "SELECT * FROM ai_copy_automation_settings WHERE rule_id=6 AND purpose='initial_email'",
        )
    ).rows[0];
    let unbound = await createAutomationCycle(conn, unboundSetting, clock);
    const baseline = (
        await pg.query("SELECT snapshot FROM ai_copy_policy_versions WHERE id=$1", [
            unbound.baseline_policy_id,
        ])
    ).rows[0];
    const unboundB = await createPolicyVersion(conn, {
        orgId: org,
        userId: user,
        workspaceId: 8,
        name: "격리 검증 후보",
        snapshot: {
            ...baseline.snapshot,
            instructions: "기존 의미를 보존하면서 질문 하나를 부담 없는 말투로 변주하세요.",
        },
    });
    await pg.query(
        "UPDATE ai_copy_policy_versions SET state='approved',approval_method='automatic_evaluation' WHERE id=$1",
        [unboundB.id],
    );
    await pg.query(
        "UPDATE ai_copy_automation_cycles SET candidate_policy_id=$2,stage='ready_for_experiment' WHERE id=$1",
        [unbound.id, unboundB.id],
    );
    await advanceAutomation(conn, unboundSetting, await fresh(unbound.id), deps, true);
    unbound = await fresh(unbound.id);
    assert.equal(unbound.stage, "experimenting");
    assert.equal(
        (await pg.query("SELECT count(*)::int AS n FROM ai_copy_bindings WHERE rule_id=6")).rows[0]
            .n,
        0,
    );
    const pinned = await enrollForPreparation(conn, {
        orgId: org,
        workspaceId: 8,
        ruleId: 6,
        recordId: 50999,
        email: "auto-999@outside.test",
        plannedAt: clock,
        senderId: 1,
        senderEmail: "demo@internal.test",
        now: clock,
        internal: false,
    });
    assert.equal(pinned.kind, "assigned");
    assert.ok([unbound.baseline_policy_id, unboundB.id].includes(pinned.policy.id));
    scenarios++;
    assert.equal(
        (await applyAutomationCycle(conn, await fresh(ack.id), actor(), false)).unchanged,
        true,
    );
    scenarios++;
    await configureCopyAutomation(
        conn,
        { workspaceId: 8, enabled: false, experimentMode: "manual" },
        actor(),
    );
    assert.equal(
        (
            await pg.query("SELECT state FROM email_copy_experiments WHERE id=$1", [
                autoCycle.experiment_id,
            ])
        ).rows[0].state,
        "closed",
    );
    assert.equal(
        (await pg.query("SELECT count(*)::int AS n FROM ai_copy_automation_settings WHERE enabled"))
            .rows[0].n,
        0,
    );
    scenarios++;
    console.log(
        JSON.stringify({
            automationPassed: true,
            scenarios,
            modelCalls: calls,
            testProvider: true,
            actualCustomerSends: 0,
            actualHumanReviews: false,
            manualFinalApplication: true,
        }),
    );
}).catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
