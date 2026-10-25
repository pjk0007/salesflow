import type { CopyConnection } from "../ai-copy/types";
import { normalizeEmail } from "../deep-visitor-alert-rules";
import { evaluateCondition, type TriggerCondition } from "../automation-condition";
import { previewCapacitySchedule } from "./capacity";
import { kstParts } from "../kst";
import { loadExperimentRule } from "./repository";
import type { Experiment } from "./types";
import { canonicalCompany } from "../ai-copy/automation-rules";

export const PUBLIC_EMAIL_DOMAINS = new Set([
    "gmail.com",
    "naver.com",
    "daum.net",
    "hanmail.net",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
    "kakao.com",
]);
export async function loadInternalAudience(
    conn: CopyConnection,
    orgId: string,
    configuredDomains: string[] = [],
) {
    const users = await conn<
        { email: string }[]
    >`SELECT DISTINCT u.email FROM users u LEFT JOIN organization_members m ON m.user_id=u.id WHERE u.is_active=1 AND (u.org_id=${orgId} OR m.organization_id=${orgId})`;
    const senders = await conn<
        { from_email: string }[]
    >`SELECT from_email FROM email_sender_profiles WHERE org_id=${orgId}`;
    const names = await conn<{ name: string }[]>`SELECT name FROM organizations WHERE id=${orgId}
        UNION SELECT name FROM workspaces WHERE org_id=${orgId}`;
    const companies = new Set(names.flatMap((n) => canonicalCompany(n.name) ?? []));
    const emails = new Set([
        ...users.map((u) => normalizeEmail(u.email)),
        ...senders.map((s) => normalizeEmail(s.from_email)),
    ]);
    const domains = new Set(configuredDomains.map((d) => d.trim().toLowerCase()).filter(Boolean));
    for (const address of emails) {
        const domain = address.split("@")[1];
        if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) domains.add(domain);
    }
    return { emails, domains, companies };
}
export const internalAudienceContains = (
    audience: Awaited<ReturnType<typeof loadInternalAudience>>,
    email: string,
    company?: unknown,
) => {
    const normalized = normalizeEmail(email);
    return (
        audience.emails.has(normalized) ||
        audience.domains.has(normalized.split("@")[1]) ||
        audience.companies.has(canonicalCompany(company) ?? "")
    );
};
export async function previewExperiment(
    conn: CopyConnection,
    input: { orgId: string; experiment: Experiment; now: Date; internalDomains?: string[] },
) {
    const { experiment } = input,
        rule = await loadExperimentRule(
            conn,
            input.orgId,
            experiment.workspace_id,
            experiment.rule_id,
        );
    const audience = await loadInternalAudience(conn, input.orgId, input.internalDomains);
    const recipientAnalysis = experiment.config.analysisUnit === "recipient";
    const contacts = recipientAnalysis
        ? []
        : await conn<
              {
                  normalized_email: string;
                  company_key: string | null;
                  company_verified: boolean;
                  tier: string;
              }[]
          >`SELECT * FROM email_copy_experiment_contacts WHERE org_id=${input.orgId} AND workspace_id=${experiment.workspace_id}`;
    const byEmail = new Map(contacts.map((c) => [c.normalized_email, c]));
    const sent = await conn<
        { recipient_email: string }[]
    >`SELECT DISTINCT l.recipient_email FROM email_send_logs l JOIN partitions p ON p.id=l.partition_id WHERE l.org_id=${input.orgId} AND p.workspace_id=${experiment.workspace_id}
        AND (l.status IN('pending','sent','delivered','uncertain') OR l.status='failed' AND l.request_id IS NOT NULL AND (l.nhn_status_code IS NOT NULL OR l.delivery_fail_source IS NOT NULL))`;
    const unsubscribedRows = await conn<
        { email: string }[]
    >`SELECT email FROM email_unsubscribes WHERE org_id=${input.orgId}`;
    const unsubscribed = new Set(unsubscribedRows.map((r) => normalizeEmail(r.email)));
    const alreadySent = new Set(sent.map((r) => normalizeEmail(r.recipient_email))),
        seenEmails = new Set<string>(),
        seenCompanies = new Set<string>();
    const counts = {
        queuedRecords: 0,
        conditionExcluded: 0,
        invalidEmail: 0,
        duplicateEmail: 0,
        internal: 0,
        unsubscribed: 0,
        alreadyContacted: 0,
        alreadyPrepared: 0,
        held: 0,
        companyDuplicate: 0,
        primary: 0,
        exploratory: 0,
    };
    let cursor = 0;
    for (;;) {
        const batch = await conn<
            {
                id: number;
                data: Record<string, unknown> | string;
                queue_state: string;
                already_prepared: boolean;
            }[]
        >`SELECT r.id,r.data,q.status AS queue_state,
            EXISTS(SELECT 1 FROM email_prepared_sends s WHERE s.queue_id=q.id AND s.link_id=${experiment.rule_id} AND s.payload IS NOT NULL AND s.status NOT IN('cancelled')) AS already_prepared
            FROM records r JOIN email_send_queue q ON q.record_id=r.id AND q.org_id=${input.orgId} AND q.trigger_type=${rule.trigger_type}
            WHERE r.org_id=${input.orgId} AND r.partition_id=${rule.partition_id} AND q.status IN('pending','processing','held') AND r.id>${cursor} ORDER BY r.id LIMIT 1000`;
        if (!batch.length) break;
        for (const record of batch) {
            counts.queuedRecords++;
            const data =
                typeof record.data === "string"
                    ? (JSON.parse(record.data) as Record<string, unknown>)
                    : record.data;
            if (!evaluateCondition(rule.trigger_condition as TriggerCondition | null, data)) {
                counts.conditionExcluded++;
                continue;
            }
            const raw = data[String(rule.recipient_field)],
                email = typeof raw === "string" ? normalizeEmail(raw) : "";
            if (!email || !email.includes("@")) {
                counts.invalidEmail++;
                continue;
            }
            if (seenEmails.has(email)) {
                counts.duplicateEmail++;
                continue;
            }
            seenEmails.add(email);
            if (internalAudienceContains(audience, email, data[String(rule.company_field)])) {
                counts.internal++;
                continue;
            }
            if (unsubscribed.has(email)) {
                counts.unsubscribed++;
                continue;
            }
            if (alreadySent.has(email)) {
                counts.alreadyContacted++;
                continue;
            }
            if (record.queue_state === "held") {
                counts.held++;
                continue;
            }
            if (record.already_prepared) {
                counts.alreadyPrepared++;
                continue;
            }
            if (recipientAnalysis) {
                counts.primary++;
                continue;
            }
            const contact = byEmail.get(email);
            if (contact?.company_verified && contact.company_key) {
                if (seenCompanies.has(contact.company_key)) {
                    counts.companyDuplicate++;
                    continue;
                }
                seenCompanies.add(contact.company_key);
                counts.primary++;
            } else counts.exploratory++;
        }
        cursor = batch[batch.length - 1].id;
    }
    const allProfiles =
        await conn`SELECT * FROM email_sender_profiles WHERE org_id=${input.orgId} ORDER BY id`;
    const configuredIds = Array.isArray(rule.sender_profile_ids)
        ? (rule.sender_profile_ids as number[])
        : rule.sender_profile_id
          ? [Number(rule.sender_profile_id)]
          : null;
    // 실제 발송과 같은 주소 선택(묶음 → 기본 → 설정 발신자). 주소가 없으면 제한 없음(null)이다 (UX-159)
    const days = previewCapacitySchedule(allProfiles, configuredIds, kstParts(input.now).date);
    const requiredTotal = experiment.config.plannedPerArm * 2;
    let cumulative = 0,
        requiredDays: number | null = null;
    for (let i = 0; i < days.length; i++) {
        cumulative += days[i].capacity ?? requiredTotal;
        if (cumulative >= requiredTotal) {
            requiredDays = Math.max(14, i + 1);
            break;
        }
    }
    const warnings: string[] = [];
    if (counts.primary < requiredTotal)
        warnings.push(
            recipientAnalysis
                ? "현재 대기열의 비교 대상 고객만으로는 계획 표본을 채울 수 없습니다."
                : "현재 대기열의 기존 회사 단위 비교 대상으로는 계획 표본을 채울 수 없습니다.",
        );
    if (requiredDays === null)
        warnings.push("설정된 발신 한도로는 최대 42일 안에 계획 표본을 모집하기 어렵습니다.");
    if (days.some((d) => d.capacity === null))
        warnings.push("발신량 한도가 없는 주소가 있어 실제 수집 기간은 예측할 수 없습니다.");
    return {
        analysisUnit: experiment.config.analysisUnit ?? ("legacy_company" as const),
        counts,
        requiredPerArm: experiment.config.plannedPerArm,
        requiredTotal,
        capacitySchedule: days,
        estimatedMinimumEnrollmentDays: requiredDays,
        earliestDecisionDays: requiredDays === null ? null : requiredDays + 14,
        warnings,
        explanation:
            "현재 적재된 대기열과 발신 설정을 기준으로 한 예상입니다. 다른 규칙의 발송·후속·오늘 사용량과 신규 고객 유입에 따라 실제 기간이 늘어납니다. 이미 준비한 본문은 실험에 편입하지 않습니다.",
    };
}
