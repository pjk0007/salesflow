import type {
    CopyConnection,
    CopyVersion,
    KnowledgeSnapshot,
    PolicySnapshot,
} from "../ai-copy/types";
import { fingerprint } from "../ai-copy/rules";
import { copyTransaction, CopyDeferredError } from "../ai-copy/generation";
import { CopyActionError } from "../ai-copy/errors";
import { normalizeEmail } from "../deep-visitor-alert-rules";
import { kstParts } from "../kst";
import { chooseBalancedArm, DAY_MS, experimentInputSchema, plannedSamplePerArm } from "./rules";
import type { Assignment, Experiment, ExperimentConfig, ExperimentState } from "./types";

const ruleKeys = [
    "prompt",
    "recipientField",
    "companyField",
    "productId",
    "tone",
    "ctaUrl",
    "format",
    "signatureId",
    "useSignaturePersona",
    "senderProfileIds",
    "senderEmail",
    "senderName",
    "followupConfig",
    "useUnsubscribe",
    "preventDuplicate",
    "triggerCondition",
    "triggerType",
    "autoResearch",
    "model",
    "isActive",
    "assetIds",
];
export function ruleSnapshotOf(rule: Record<string, unknown>) {
    const value = Object.fromEntries(
        ruleKeys.map((key) => [
            key,
            rule[key] ?? rule[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] ?? null,
        ]),
    );
    value.resolvedCtaUrl = value.ctaUrl || rule.product_url || null;
    value.assetUrls = rule.asset_urls ?? [];
    return value;
}
export async function loadExperimentRule(
    conn: CopyConnection,
    orgId: string,
    workspaceId: number,
    ruleId: number,
) {
    const [rule] =
        await conn`SELECT l.*,x.url AS product_url,COALESCE((SELECT jsonb_agg(a.url ORDER BY ids.ordinality)
        FROM jsonb_array_elements_text(COALESCE(l.asset_ids,'[]'::jsonb)) WITH ORDINALITY ids(id,ordinality)
        JOIN email_assets a ON a.id=ids.id::int AND a.org_id=l.org_id),'[]'::jsonb) AS asset_urls FROM email_auto_personalized_links l JOIN partitions p ON p.id=l.partition_id
        JOIN workspaces w ON w.id=p.workspace_id AND w.org_id=l.org_id LEFT JOIN products x ON x.id=l.product_id AND x.org_id=l.org_id
        WHERE l.org_id=${orgId} AND w.id=${workspaceId} AND l.id=${ruleId}`;
    if (!rule) throw new CopyActionError("해당 사업의 AI 자동발송 규칙을 찾을 수 없습니다.");
    return rule;
}
export async function experimentEvent(
    conn: CopyConnection,
    input: {
        orgId: string;
        experimentId: number;
        userId?: string;
        action: string;
        detail?: unknown;
    },
) {
    await conn`INSERT INTO email_copy_experiment_events(org_id,experiment_id,actor_id,action,detail)
        VALUES(${input.orgId},${input.experimentId},${input.userId ?? null},${input.action},${JSON.stringify(input.detail ?? {})}::jsonb)`;
}
async function loadVersions(conn: CopyConnection, experiment: Experiment, approved: boolean) {
    const policies = await conn<
        CopyVersion<PolicySnapshot>[]
    >`SELECT * FROM ai_copy_policy_versions WHERE org_id=${experiment.org_id} AND workspace_id=${experiment.workspace_id}
        AND id IN (${experiment.config.policyAId},${experiment.config.policyBId}) AND purpose='initial_email' AND state<> 'blocked'`;
    const [knowledge] = await conn<
        CopyVersion<KnowledgeSnapshot>[]
    >`SELECT * FROM ai_copy_knowledge_versions WHERE id=${experiment.config.knowledgeVersionId} AND org_id=${experiment.org_id} AND workspace_id=${experiment.workspace_id} AND state<>'blocked'`;
    if (
        policies.length !== 2 ||
        !knowledge ||
        (approved &&
            (policies.some((p) => p.state !== "approved") || knowledge.state !== "approved"))
    )
        throw new CopyActionError(
            "같은 사업의 승인된 첫 메일 작성 지침 두 개와 지식이 필요합니다.",
        );
    const A = policies.find((p) => p.id === experiment.config.policyAId)!,
        B = policies.find((p) => p.id === experiment.config.policyBId)!;
    const common = (snapshot: PolicySnapshot) => ({ ...snapshot, instructions: "" });
    if (
        fingerprint(common(A.snapshot)) !== fingerprint(common(B.snapshot)) ||
        A.snapshot.instructions === B.snapshot.instructions
    )
        throw new CopyActionError(
            "A/B는 작성 지침 한 항목만 달라야 합니다. 모델·생성 설정·필수 의미·길이 제한·검증·성능 기준을 동일하게 맞춰 주세요.",
        );
    return { A, B, knowledge };
}
export async function createExperiment(
    conn: CopyConnection,
    input: unknown,
    actor: { orgId: string; userId: string },
) {
    const value = experimentInputSchema.parse(input);
    const rule = await loadExperimentRule(conn, actor.orgId, value.workspaceId, value.ruleId),
        snapshot = ruleSnapshotOf(rule);
    const config: ExperimentConfig = {
        ...value,
        primaryMetric: "positive_reply_14d_itt",
        allocation: 0.5,
        alpha: 0.05,
        power: 0.8,
        plannedPerArm: plannedSamplePerArm(value.baselineRate, value.minimumDetectableEffect),
        minEnrollmentDays: 14,
        maxEnrollmentDays: 42,
        observationDays: 14,
        meetingDays: 30,
        ruleSnapshot: snapshot,
        ruleFingerprint: fingerprint(snapshot),
    };
    return copyTransaction(conn, async () => {
        const [experiment] = await conn<
            Experiment[]
        >`INSERT INTO email_copy_experiments(org_id,workspace_id,rule_id,name,config,config_fingerprint,created_by)
            VALUES(${actor.orgId},${value.workspaceId},${value.ruleId},${value.name},${JSON.stringify(config)}::jsonb,${fingerprint(config)},${actor.userId}) RETURNING *`;
        await loadVersions(conn, experiment, false);
        await experimentEvent(conn, {
            ...actor,
            experimentId: experiment.id,
            action: "created",
            detail: { plannedPerArm: config.plannedPerArm },
        });
        return experiment;
    });
}
async function requireManualOwner(conn: CopyConnection, experiment: Experiment) {
    if (experiment.config.replySource !== "manual") return;
    const [owner] =
        await conn`SELECT u.id FROM users u JOIN organization_members m ON m.user_id=u.id AND m.organization_id=${experiment.org_id}
        WHERE u.id=${experiment.config.manualCollectionOwnerId} AND u.is_active=1`;
    if (!owner) throw new CopyActionError("수동 회신 기록 담당자의 조직 권한을 확인해 주세요.");
}
export async function startExperiment(
    conn: CopyConnection,
    input: {
        orgId: string;
        userId: string;
        id: number;
        now: Date;
        connectedReplyAvailable: boolean;
    },
) {
    return copyTransaction(conn, async () => {
        const [experiment] = await conn<
            Experiment[]
        >`SELECT * FROM email_copy_experiments WHERE id=${input.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!experiment || !["draft", "evaluated"].includes(experiment.state))
            throw new CopyActionError("시작할 수 있는 실험 초안이 아닙니다.");
        const rule = await loadExperimentRule(
            conn,
            input.orgId,
            experiment.workspace_id,
            experiment.rule_id,
        );
        if (rule.is_active !== 1 || rule.is_draft === 1)
            throw new CopyActionError("활성화된 이메일 규칙을 선택해 주세요.");
        if (fingerprint(ruleSnapshotOf(rule)) !== experiment.config.ruleFingerprint)
            throw new CopyActionError(
                "규칙이 초안 작성 이후 변경됐습니다. 변경한 조건으로 새 실험을 만들어 주세요.",
            );
        const { A, knowledge } = await loadVersions(conn, experiment, true);
        const [binding] =
            await conn`SELECT 1 FROM ai_copy_bindings WHERE org_id=${input.orgId} AND workspace_id=${experiment.workspace_id} AND purpose='initial_email' AND rule_id=${experiment.rule_id}
            AND policy_version_id=${A.id} AND knowledge_version_id=${knowledge.id}`;
        if (!binding)
            throw new CopyActionError(
                "현재 발송 연결을 A 작성 지침과 실험 지식 버전으로 맞춘 뒤 시작해 주세요.",
            );
        if (experiment.config.replySource === "connected" && !input.connectedReplyAvailable)
            throw new CopyActionError(
                "회신 수집 연결이 확인되지 않았습니다. 연결을 복구하거나 수동 수집 담당자로 새 실험을 만드세요.",
            );
        await requireManualOwner(conn, experiment);
        await conn`SELECT pg_advisory_xact_lock(1760824303,hashtext(${input.orgId}))`;
        const [active] =
            await conn`SELECT id FROM email_copy_experiments WHERE org_id=${input.orgId} AND workspace_id=${experiment.workspace_id} AND rule_id=${experiment.rule_id}
            AND state IN('running','enrollment_closed','observing','decision_ready','paused','data_check','insufficient_sample')`;
        if (active) throw new CopyActionError("같은 규칙에서 진행 중인 실험이 있습니다.");
        await conn`UPDATE email_copy_experiments SET state='running',started_at=${input.now.toISOString()} WHERE id=${experiment.id}`;
        await experimentEvent(conn, {
            ...input,
            experimentId: experiment.id,
            action: "started",
            detail: {
                ratio: "50:50",
                scope: "first_body",
                primaryMetric: experiment.config.primaryMetric,
            },
        });
        return {
            startedAt: input.now,
            pinnedVersions: {
                A: experiment.config.policyAId,
                B: experiment.config.policyBId,
                knowledge: knowledge.id,
            },
        };
    });
}
export async function changeExperimentState(
    conn: CopyConnection,
    input: {
        orgId: string;
        userId: string;
        id: number;
        action: "pause" | "resume" | "close_enrollment" | "invalidate" | "close";
        pendingMode: "continue" | "hold";
        reason: string;
        now: Date;
    },
) {
    return copyTransaction(conn, async () => {
        const [experiment] = await conn<
            Experiment[]
        >`SELECT * FROM email_copy_experiments WHERE id=${input.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!experiment || experiment.state === "closed")
            throw new CopyActionError("변경할 수 있는 실험이 아닙니다.");
        if (input.reason.trim().length < 10)
            throw new CopyActionError("변경 이유를 10자 이상 적어 주세요.");
        let state: ExperimentState;
        if (input.action === "pause") {
            if (!["running", "observing", "enrollment_closed"].includes(experiment.state))
                throw new CopyActionError("진행 중인 실험만 일시 중지할 수 있습니다.");
            state = "paused";
            await conn`UPDATE email_copy_experiments SET paused_from=state,pending_mode=${input.pendingMode} WHERE id=${experiment.id}`;
        } else if (input.action === "resume") {
            if (experiment.state !== "paused")
                throw new CopyActionError("일시 중지한 실험만 재개할 수 있습니다.");
            await loadVersions(conn, experiment, true);
            const rule = await loadExperimentRule(
                conn,
                input.orgId,
                experiment.workspace_id,
                experiment.rule_id,
            );
            if (fingerprint(ruleSnapshotOf(rule)) !== experiment.config.ruleFingerprint)
                throw new CopyActionError(
                    "규칙 변경을 원래대로 되돌리거나 새 실험을 만들어 주세요.",
                );
            state = experiment.paused_from ?? "running";
        } else if (input.action === "close_enrollment") {
            if (!["running", "paused"].includes(experiment.state))
                throw new CopyActionError("모집 중인 실험만 모집을 종료할 수 있습니다.");
            state = "observing";
            await conn`UPDATE email_copy_experiments SET enrollment_closed_at=${input.now.toISOString()} WHERE id=${experiment.id}`;
        } else if (input.action === "invalidate") {
            state = "invalidated";
            await conn`UPDATE email_copy_experiments SET invalidation_reason=${input.reason},pending_mode='hold' WHERE id=${experiment.id}`;
            await conn`UPDATE ai_copy_generation_jobs SET state='held',reason='실험 무효화',lease_token=NULL,lease_until=NULL WHERE assignment_id IN(SELECT id FROM email_copy_assignments WHERE experiment_id=${experiment.id}) AND send_log_id IS NULL`;
        } else {
            state = "closed";
            await conn`UPDATE email_copy_experiments SET closed_at=${input.now.toISOString()},pending_mode=${input.pendingMode},enrollment_closed_at=COALESCE(enrollment_closed_at,${input.now.toISOString()}) WHERE id=${experiment.id}`;
            if (input.pendingMode === "hold")
                await conn`UPDATE ai_copy_generation_jobs SET state='cancelled',reason='실험 종료로 미발송 작업 취소',lease_token=NULL,lease_until=NULL WHERE assignment_id IN(SELECT id FROM email_copy_assignments WHERE experiment_id=${experiment.id}) AND send_log_id IS NULL`;
        }
        await conn`UPDATE email_copy_experiments SET state=${state} WHERE id=${experiment.id}`;
        await experimentEvent(conn, {
            ...input,
            experimentId: experiment.id,
            action: input.action,
            detail: { reason: input.reason, pendingMode: input.pendingMode, state },
        });
        return { state };
    });
}
export type EnrollmentResult =
    | { kind: "none" }
    | { kind: "excluded"; reason: string }
    | {
          kind: "assigned";
          experiment: Experiment;
          assignment: Assignment;
          policy: CopyVersion<PolicySnapshot>;
          knowledge: CopyVersion<KnowledgeSnapshot>;
      };
export async function enrollForPreparation(
    conn: CopyConnection,
    input: {
        orgId: string;
        workspaceId: number;
        ruleId: number;
        recordId: number;
        email: string;
        plannedAt: Date;
        senderId: number | null;
        senderEmail?: string | null;
        now: Date;
        internal: boolean;
    },
): Promise<EnrollmentResult> {
    const email = normalizeEmail(input.email);
    if (!email || !email.includes("@")) return { kind: "excluded", reason: "invalid_email" };
    return copyTransaction(conn, async (): Promise<EnrollmentResult> => {
        await conn`SELECT pg_advisory_xact_lock(1760824303,hashtext(${input.orgId}))`;
        const [previous] = await conn<
            Assignment[]
        >`SELECT a.* FROM email_copy_assignments a JOIN email_copy_experiments e ON e.id=a.experiment_id
            WHERE a.org_id=${input.orgId} AND a.workspace_id=${input.workspaceId} AND e.rule_id=${input.ruleId} AND a.normalized_email=${email} ORDER BY a.id DESC LIMIT 1`;
        const [experiment] = previous
            ? await conn<
                  Experiment[]
              >`SELECT * FROM email_copy_experiments WHERE id=${previous.experiment_id} AND org_id=${input.orgId} FOR UPDATE`
            : await conn<
                  Experiment[]
              >`SELECT * FROM email_copy_experiments WHERE org_id=${input.orgId} AND workspace_id=${input.workspaceId} AND rule_id=${input.ruleId}
                AND state IN('running','paused','enrollment_closed','observing','decision_ready','data_check','insufficient_sample') ORDER BY id DESC LIMIT 1 FOR UPDATE`;
        if (!experiment) return { kind: "none" };
        if (previous && experiment.state === "closed" && experiment.pending_mode === "hold")
            throw new CopyDeferredError(
                new Date(input.now.getTime() + 3600_000),
                "작업 취소",
                true,
            );
        if (
            experiment.state === "invalidated" ||
            experiment.state === "data_check" ||
            (experiment.state === "paused" && (experiment.pending_mode === "hold" || !previous))
        )
            throw new CopyDeferredError(
                new Date(input.now.getTime() + 3600_000),
                "실험 준비 보류",
                true,
            );
        if (input.internal) return { kind: "excluded", reason: "internal" };
        const rule = await loadExperimentRule(conn, input.orgId, input.workspaceId, input.ruleId);
        if (
            fingerprint(ruleSnapshotOf(rule)) !== experiment.config.ruleFingerprint &&
            !(experiment.state === "closed" && previous?.generation_job_id)
        ) {
            if (experiment.state === "closed") return { kind: "excluded", reason: "invalidated" };
            // 트랜잭션 밖 예외가 변경 기록까지 되돌리지 않도록 결과로 반환한다.
            await conn`UPDATE email_copy_experiments SET state='invalidated',invalidation_reason='모집 후 발송 규칙 변경',pending_mode='hold' WHERE id=${experiment.id}`;
            await experimentEvent(conn, {
                orgId: input.orgId,
                experimentId: experiment.id,
                action: "rule_changed",
                detail: { fingerprint: fingerprint(ruleSnapshotOf(rule)) },
            });
            return { kind: "excluded", reason: "invalidated" };
        }
        const [blocked] = await conn<
            { blocked: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM ai_copy_policy_versions WHERE id IN(${experiment.config.policyAId},${experiment.config.policyBId}) AND state='blocked')
            OR EXISTS(SELECT 1 FROM ai_copy_knowledge_versions WHERE id=${experiment.config.knowledgeVersionId} AND state='blocked') AS blocked`;
        if (blocked.blocked) {
            if (experiment.state !== "closed")
                await conn`UPDATE email_copy_experiments SET state='invalidated',invalidation_reason='사용 버전 차단',pending_mode='hold' WHERE id=${experiment.id}`;
            return { kind: "excluded", reason: "invalidated" };
        }
        const { A, B, knowledge } = await loadVersions(conn, experiment, false);
        if (previous)
            return {
                kind: "assigned",
                assignment: previous,
                experiment,
                policy: previous.arm === "A" ? A : B,
                knowledge,
            };
        const [overlap] =
            await conn`SELECT a.id FROM email_copy_assignments a JOIN email_copy_experiments e ON e.id=a.experiment_id WHERE a.org_id=${input.orgId} AND a.normalized_email=${email}
            AND e.id<>${experiment.id} AND e.state IN('running','paused','enrollment_closed','observing','decision_ready','data_check','insufficient_sample') LIMIT 1`;
        if (overlap) return { kind: "excluded", reason: "concurrent_experiment" };
        const [contact] = await conn<
            { company_key: string | null; company_verified: boolean; tier: string }[]
        >`SELECT * FROM email_copy_experiment_contacts WHERE org_id=${input.orgId} AND workspace_id=${input.workspaceId} AND normalized_email=${email}`;
        const cohort = contact?.company_verified && contact.company_key ? "primary" : "exploratory";
        if (cohort === "primary") {
            const [company] =
                await conn`SELECT id FROM email_copy_assignments WHERE experiment_id=${experiment.id} AND company_key=${contact.company_key} AND cohort='primary' LIMIT 1`;
            if (company) return { kind: "excluded", reason: "company_representative_exists" };
        }
        if (experiment.state !== "running") return { kind: "none" };
        const [counts] = await conn<
            { A: number; B: number }[]
        >`SELECT count(*) FILTER(WHERE arm='A')::int AS "A",count(*) FILTER(WHERE arm='B')::int AS "B" FROM email_copy_assignments WHERE experiment_id=${experiment.id} AND cohort='primary'`;
        const elapsed = input.now.getTime() - new Date(experiment.started_at!).getTime();
        if (
            elapsed >= experiment.config.maxEnrollmentDays * DAY_MS ||
            (elapsed >= experiment.config.minEnrollmentDays * DAY_MS &&
                counts.A >= experiment.config.plannedPerArm &&
                counts.B >= experiment.config.plannedPerArm)
        ) {
            const state =
                counts.A >= experiment.config.plannedPerArm &&
                counts.B >= experiment.config.plannedPerArm
                    ? "observing"
                    : "insufficient_sample";
            await conn`UPDATE email_copy_experiments SET state=${state},enrollment_closed_at=${input.now.toISOString()} WHERE id=${experiment.id}`;
            await experimentEvent(conn, {
                orgId: input.orgId,
                experimentId: experiment.id,
                action: "enrollment_closed",
                detail: { state, counts },
            });
            return { kind: "none" };
        }
        const [priorSend] =
            await conn`SELECT l.id FROM email_send_logs l JOIN partitions p ON p.id=l.partition_id WHERE l.org_id=${input.orgId} AND p.workspace_id=${input.workspaceId}
            AND lower(trim(l.recipient_email))=${email} AND (l.status IN('pending','sent','delivered','uncertain') OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL)) LIMIT 1`;
        if (priorSend) return { kind: "excluded", reason: "already_contacted" };
        const tier = contact?.tier ?? "unclassified",
            customerKey = fingerprint([input.orgId, input.workspaceId, email]);
        const stratum = fingerprint([
            input.workspaceId,
            input.senderId,
            kstParts(input.plannedAt).date,
            tier,
        ]);
        const [stratumCounts] = await conn<
            { A: number; B: number }[]
        >`SELECT count(*) FILTER(WHERE arm='A')::int AS "A",count(*) FILTER(WHERE arm='B')::int AS "B" FROM email_copy_assignments WHERE experiment_id=${experiment.id} AND stratum=${stratum} AND cohort=${cohort}`;
        const arm = chooseBalancedArm({
            experimentId: experiment.id,
            customerKey,
            stratum,
            countA: stratumCounts.A,
            countB: stratumCounts.B,
        });
        const [assignment] = await conn<
            Assignment[]
        >`INSERT INTO email_copy_assignments(experiment_id,org_id,workspace_id,normalized_email,customer_key,arm,cohort,company_key,record_id,initial_scheduled_at,planned_sender_id,planned_sender_email,stratum,tier,assigned_at)
            VALUES(${experiment.id},${input.orgId},${input.workspaceId},${email},${customerKey},${arm},${cohort},${cohort === "primary" ? contact.company_key : null},${input.recordId},${input.plannedAt.toISOString()},${input.senderId},${input.senderEmail ? normalizeEmail(input.senderEmail) : null},${stratum},${tier},${input.now.toISOString()}) RETURNING *`;
        return { kind: "assigned", assignment, experiment, policy: arm === "A" ? A : B, knowledge };
    });
}
