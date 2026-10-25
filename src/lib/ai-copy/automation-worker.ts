import { queryClient } from "../db";
import type { CopyConnection } from "./types";
import { generationDeps } from "./runtime";
import { CopyDeferredError, type GenerationDeps } from "./generation";
import { CopyActionError } from "./errors";
import {
    advanceAutomation,
    automationRuleChanged,
    createAutomationCycle,
    type AutomationCycle,
    type AutomationSetting,
} from "./automation";
import { connectedReplyAvailable } from "../email-experiments/runtime";
import { advanceExperimentLifecycles } from "../email-experiments/actions";

export async function processCopyAutomation(provided?: {
    conn: CopyConnection;
    deps: GenerationDeps;
    connected?: (org: string, workspace: number, now: Date) => Promise<boolean>;
}) {
    const conn = provided?.conn ?? (await queryClient.reserve()),
        deps = provided?.deps ?? generationDeps();
    let locked = false;
    try {
        const [lock] = await conn<
            { locked: boolean }[]
        >`SELECT pg_try_advisory_lock(1760824305) AS locked`;
        if (!lock.locked) return { processed: 0, busy: true };
        locked = true;
        const now = deps.now();
        await conn`INSERT INTO ai_copy_automation_settings(org_id,workspace_id,purpose,rule_id,enabled,experiment_mode,actor_id)
            SELECT s.org_id,s.workspace_id,'initial_email',l.id,true,s.experiment_mode,s.actor_id FROM ai_copy_automation_settings s JOIN partitions p ON p.workspace_id=s.workspace_id
            JOIN email_auto_personalized_links l ON l.partition_id=p.id AND l.org_id=s.org_id WHERE s.purpose='visit_ack' AND s.enabled AND l.is_active=1 AND l.is_draft=0
            ON CONFLICT(org_id,workspace_id,purpose,rule_id) DO NOTHING`;
        const [setting] = await conn<
            AutomationSetting[]
        >`SELECT s.* FROM ai_copy_automation_settings s JOIN users u ON u.id=s.actor_id
            WHERE s.enabled AND s.next_run_at<=${now.toISOString()} AND u.is_active=1 AND EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=s.org_id AND m.user_id=u.id AND m.role IN('owner','admin'))
            ORDER BY s.next_run_at,s.id LIMIT 1`;
        if (!setting) return { processed: 0 };
        let cycle: AutomationCycle | undefined;
        try {
            [cycle] = await conn<
                AutomationCycle[]
            >`SELECT * FROM ai_copy_automation_cycles WHERE setting_id=${setting.id} AND stage NOT IN('applied','declined','blocked') ORDER BY id DESC LIMIT 1`;
            if (!cycle) {
                const [latest] = await conn<
                    { updated_at: Date; stage: string; rule_fingerprint: string | null }[]
                >`SELECT updated_at,stage,rule_fingerprint FROM ai_copy_automation_cycles WHERE setting_id=${setting.id} ORDER BY id DESC LIMIT 1`;
                // 7일 대기는 적용·유지로 끝난 회차에만 둔다. 준비 보류 회차는 관리자가 '다시 준비'(last_error 비움)하거나
                // 발송 규칙이 바뀌면 바로 새 회차를 연다(UX-246).
                const reopenBlocked =
                    latest?.stage === "blocked" &&
                    (setting.last_error == null ||
                        (await automationRuleChanged(conn, setting, latest.rule_fingerprint)));
                if (
                    latest &&
                    !reopenBlocked &&
                    new Date(latest.updated_at).getTime() + 7 * 86400000 > now.getTime()
                ) {
                    await conn`UPDATE ai_copy_automation_settings SET next_run_at=${new Date(new Date(latest.updated_at).getTime() + 7 * 86400000).toISOString()} WHERE id=${setting.id}`;
                    return { processed: 0, cooldown: true };
                }
                cycle = await createAutomationCycle(conn, setting, now);
            } else {
                const connected = await (provided?.connected ?? connectedReplyAvailable)(
                    setting.org_id,
                    setting.workspace_id,
                    now,
                );
                if (cycle.experiment_id)
                    await advanceExperimentLifecycles(conn, now, setting.org_id);
                await advanceAutomation(conn, setting, cycle, deps, connected);
            }
            // 이번 진행으로 회차가 보류(예: 자동 평가 미달)로 끝났다면 사유를 남긴다. 비어 있으면 '다시 준비'로 보고
            // 7일 대기 없이 새 회차를 열기 때문이다(UX-246).
            await conn`UPDATE ai_copy_automation_settings SET next_run_at=${new Date(now.getTime() + 30000).toISOString()},
                last_error=(SELECT CASE WHEN c.stage='blocked' THEN COALESCE(c.reason,'준비 보류') END FROM ai_copy_automation_cycles c WHERE c.id=${cycle.id}) WHERE id=${setting.id}`;
            return { processed: 1, cycleId: cycle.id };
        } catch (error) {
            const deferred = error instanceof CopyDeferredError && !error.held;
            const reason =
                error instanceof CopyDeferredError || error instanceof CopyActionError
                    ? error.message
                    : "자동 준비를 완료하지 못했습니다. 기존 지침을 유지합니다.";
            if (cycle)
                await conn`UPDATE ai_copy_automation_cycles SET stage=CASE WHEN ${deferred} THEN stage ELSE 'blocked' END,reason=${reason},updated_at=now() WHERE id=${cycle.id}`;
            await conn`UPDATE ai_copy_automation_settings SET last_error=${reason},next_run_at=${(deferred ? (error as CopyDeferredError).retryAt : new Date(now.getTime() + 7 * 86400000)).toISOString()} WHERE id=${setting.id}`;
            return { processed: 0, deferred, reason };
        }
    } finally {
        if (locked) await conn`SELECT pg_advisory_unlock(1760824305)`;
        if (!provided) conn.release();
    }
}

const server = globalThis as typeof globalThis & {
    __sendbCopyAutomation?: ReturnType<typeof setTimeout>;
};
export function startCopyAutomationScheduler() {
    if (
        process.env.NODE_ENV !== "production" ||
        process.env.AI_COPY_AUTOMATION_WORKER === "off" ||
        server.__sendbCopyAutomation
    )
        return;
    const tick = async () => {
        try {
            await processCopyAutomation();
        } catch {
            console.error("[copy-automation] 자동 준비 회차 실패");
        } finally {
            server.__sendbCopyAutomation = setTimeout(() => void tick(), 30000);
            server.__sendbCopyAutomation.unref();
        }
    };
    server.__sendbCopyAutomation = setTimeout(() => void tick(), 30000);
    server.__sendbCopyAutomation.unref();
}
