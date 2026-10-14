import { z } from "zod";
import type { CopyConnection } from "../ai-copy/types";
import { copyTransaction } from "../ai-copy/generation";
import { CopyActionError } from "../ai-copy/errors";
import { bindCopyVersions } from "../ai-copy/versions";
import { normalizeEmail } from "../deep-visitor-alert-rules";
import { loadExperimentResults } from "./results";
import { experimentEvent } from "./repository";
import type { Experiment } from "./types";
import { PUBLIC_EMAIL_DOMAINS } from "./preview";
export async function adoptExperiment(
    conn: CopyConnection,
    input: {
        orgId: string;
        userId: string;
        id: number;
        now: Date;
        connectedReplyAvailable: boolean;
    },
    insideTransaction = false,
) {
    const apply = async () => {
        const [experiment] = await conn<
            (Experiment & { adopted_policy_id: number | null })[]
        >`SELECT * FROM email_copy_experiments WHERE id=${input.id} AND org_id=${input.orgId} FOR UPDATE`;
        if (!experiment) throw new CopyActionError("실험을 찾을 수 없습니다.");
        if (
            experiment.state === "closed" &&
            experiment.adopted_policy_id === experiment.config.policyBId
        )
            return { adopted: true, unchanged: true };
        if (!["observing", "decision_ready"].includes(experiment.state))
            throw new CopyActionError("관찰이 끝난 실험만 채택할 수 있습니다.");
        const results = await loadExperimentResults(conn, { ...input, asOf: input.now });
        if (!results.report.canAdopt)
            throw new CopyActionError(
                results.report.blocks.join(" / ") || "B의 개선을 확정할 수 없습니다.",
            );
        await bindCopyVersions(
            conn,
            {
                orgId: input.orgId,
                userId: input.userId,
                workspaceId: experiment.workspace_id,
                purpose: "initial_email",
                ruleId: experiment.rule_id,
                policyVersionId: experiment.config.policyBId,
                knowledgeVersionId: experiment.config.knowledgeVersionId,
            },
            true,
        );
        await conn`UPDATE email_copy_experiments SET state='closed',closed_at=${input.now.toISOString()},pending_mode='continue',adopted_policy_id=${experiment.config.policyBId},adopted_by=${input.userId} WHERE id=${experiment.id}`;
        await experimentEvent(conn, {
            ...input,
            experimentId: experiment.id,
            action: "adopted_b",
            detail: { appliesTo: "new_jobs_only", report: results.report, costs: results.costs },
        });
        return { adopted: true, appliesTo: "new_jobs_only" };
    };
    return insideTransaction ? apply() : copyTransaction(conn, apply);
}
export const contactInputSchema = z
    .object({
        workspaceId: z.number().int().positive(),
        email: z.email(),
        companyKey: z.string().trim().min(1).max(200).nullable(),
        companyVerified: z.boolean(),
        verificationNote: z.string().trim().max(1000),
        tier: z.string().trim().min(1).max(80),
    })
    .refine(
        (c) => !c.companyVerified || (c.companyKey !== null && c.verificationNote.length >= 10),
        "회사 확인 근거를 10자 이상 적어 주세요. 개인 메일 도메인만으로 회사를 확인하면 안 됩니다.",
    );
export async function saveExperimentContact(
    conn: CopyConnection,
    raw: unknown,
    actor: { orgId: string; userId: string; now: Date },
) {
    const value = contactInputSchema.parse(raw);
    value.companyKey =
        value.companyKey?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() ?? null;
    if (value.companyVerified && value.companyKey && PUBLIC_EMAIL_DOMAINS.has(value.companyKey))
        throw new CopyActionError(
            "개인 메일 서비스의 도메인을 회사 식별명으로 확인할 수 없습니다.",
        );
    const [workspace] =
        await conn`SELECT id FROM workspaces WHERE id=${value.workspaceId} AND org_id=${actor.orgId}`;
    if (!workspace) throw new CopyActionError("사업을 찾을 수 없습니다.");
    const [contact] =
        await conn`INSERT INTO email_copy_experiment_contacts(org_id,workspace_id,normalized_email,company_key,company_verified,verification_note,tier,verified_by,verified_at)
        VALUES(${actor.orgId},${value.workspaceId},${normalizeEmail(value.email)},${value.companyKey},${value.companyVerified},${value.verificationNote},${value.tier},${value.companyVerified ? actor.userId : null},${value.companyVerified ? actor.now.toISOString() : null})
        ON CONFLICT(org_id,workspace_id,normalized_email) DO UPDATE SET company_key=EXCLUDED.company_key,company_verified=EXCLUDED.company_verified,verification_note=EXCLUDED.verification_note,
            tier=EXCLUDED.tier,verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at RETURNING *`;
    return contact;
}
export async function saveExperimentContacts(
    conn: CopyConnection,
    raw: unknown,
    actor: { orgId: string; userId: string; now: Date },
) {
    const values = z.array(contactInputSchema).min(1).max(1000).parse(raw);
    const unique = new Map<string, (typeof values)[number]>();
    for (const value of values) {
        value.companyKey =
            value.companyKey?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() ?? null;
        if (value.companyVerified && value.companyKey && PUBLIC_EMAIL_DOMAINS.has(value.companyKey))
            throw new CopyActionError("개인 메일 도메인으로 회사가 확인됐다고 표시할 수 없습니다.");
        unique.set(`${value.workspaceId}:${normalizeEmail(value.email)}`, value);
    }
    const workspaceIds = [...new Set(values.map((v) => v.workspaceId))];
    const workspaces = await conn<
        { id: number }[]
    >`SELECT id FROM workspaces WHERE org_id=${actor.orgId} AND id IN(SELECT value::int FROM jsonb_array_elements_text(${JSON.stringify(workspaceIds)}::jsonb))`;
    if (workspaces.length !== workspaceIds.length)
        throw new CopyActionError("회사 확인 정보의 사업 권한을 확인해 주세요.");
    const payload = [...unique.values()].map((v) => ({
        org_id: actor.orgId,
        workspace_id: v.workspaceId,
        normalized_email: normalizeEmail(v.email),
        company_key: v.companyKey,
        company_verified: v.companyVerified,
        verification_note: v.verificationNote,
        tier: v.tier,
        verified_by: v.companyVerified ? actor.userId : null,
        verified_at: v.companyVerified ? actor.now.toISOString() : null,
    }));
    const saved =
        await conn`INSERT INTO email_copy_experiment_contacts(org_id,workspace_id,normalized_email,company_key,company_verified,verification_note,tier,verified_by,verified_at)
        SELECT org_id,workspace_id,normalized_email,company_key,company_verified,verification_note,tier,verified_by,verified_at FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
        AS x(org_id uuid,workspace_id int,normalized_email text,company_key text,company_verified boolean,verification_note text,tier text,verified_by uuid,verified_at timestamptz)
        ON CONFLICT(org_id,workspace_id,normalized_email) DO UPDATE SET company_key=EXCLUDED.company_key,company_verified=EXCLUDED.company_verified,verification_note=EXCLUDED.verification_note,
            tier=EXCLUDED.tier,verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at RETURNING id`;
    return { saved: saved.length };
}
/** 새 발송이 없더라도 모집 종료와 14일 성숙 상태를 진행시킨다. 성과를 보고 조기 종료하지 않는다. */
export async function advanceExperimentLifecycles(conn: CopyConnection, now: Date, orgId?: string) {
    return copyTransaction(conn, async () => {
        const changed = await conn<{ id: number; org_id: string; state: string }[]>`WITH counts AS (
        SELECT e.id,count(a.id) FILTER(WHERE a.arm='A' AND a.cohort='primary') AS n_a,count(a.id) FILTER(WHERE a.arm='B' AND a.cohort='primary') AS n_b
        FROM email_copy_experiments e LEFT JOIN email_copy_assignments a ON a.experiment_id=e.id WHERE e.state='running' AND (${orgId ?? null}::uuid IS NULL OR e.org_id=${orgId ?? null}::uuid) GROUP BY e.id
    ) UPDATE email_copy_experiments e SET state=CASE WHEN c.n_a>=(e.config->>'plannedPerArm')::int AND c.n_b>=(e.config->>'plannedPerArm')::int THEN 'observing' ELSE 'insufficient_sample' END,
        enrollment_closed_at=${now.toISOString()} FROM counts c WHERE e.id=c.id AND e.state='running' AND
        (${now.toISOString()}::timestamptz>=e.started_at+interval '42 days' OR ${now.toISOString()}::timestamptz>=e.started_at+interval '14 days' AND c.n_a>=(e.config->>'plannedPerArm')::int AND c.n_b>=(e.config->>'plannedPerArm')::int)
        RETURNING e.id,e.org_id,e.state`;
        for (const e of changed)
            await experimentEvent(conn, {
                orgId: e.org_id,
                experimentId: e.id,
                action: "enrollment_closed",
                detail: { state: e.state, cause: "predeclared_count_and_time_rule" },
            });
        await conn`UPDATE email_copy_experiments e SET state='decision_ready' WHERE e.state IN('enrollment_closed','observing') AND (${orgId ?? null}::uuid IS NULL OR e.org_id=${orgId ?? null}::uuid) AND NOT EXISTS(
        SELECT 1 FROM email_copy_assignments a WHERE a.experiment_id=e.id AND a.cohort='primary' AND a.initial_scheduled_at+interval '14 days'>${now.toISOString()}::timestamptz)`;
        return { advanced: changed.length };
    });
}
