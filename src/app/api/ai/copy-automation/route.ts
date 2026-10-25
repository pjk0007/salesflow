import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import {
    configureCopyAutomation,
    applyAutomationCycle,
    prepareAutomaticExperiment,
    type AutomationCycle,
} from "@/lib/ai-copy/automation";
import { connectedReplyAvailable } from "@/lib/email-experiments/runtime";
import { changeExperimentState } from "@/lib/email-experiments/repository";

export const GET = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const workspaceId = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("workspaceId") ?? 0);
        // actor_valid: 작업기가 실행할 수 있는 관리자(활성·owner/admin)인지. 작업기 선택 조건과 같다(UX-248).
        const settings =
            await conn`SELECT s.*,l.name AS rule_name,
                (u.is_active=1 AND EXISTS(SELECT 1 FROM organization_members m WHERE m.organization_id=s.org_id AND m.user_id=s.actor_id AND m.role IN('owner','admin'))) IS TRUE AS actor_valid
                FROM ai_copy_automation_settings s LEFT JOIN email_auto_personalized_links l ON l.id=s.rule_id AND l.org_id=s.org_id LEFT JOIN users u ON u.id=s.actor_id
                WHERE s.org_id=${user.orgId} AND (${workspaceId}=0 OR s.workspace_id=${workspaceId}) ORDER BY s.id`;
        const cycles =
            await conn`SELECT c.*,a.snapshot AS baseline_snapshot,b.snapshot AS candidate_snapshot,k.snapshot AS knowledge_snapshot,e.state AS experiment_state,
        (SELECT COALESCE(jsonb_agg(x),'[]'::jsonb) FROM (SELECT s.arm,j.output FROM ai_copy_automation_samples s JOIN ai_copy_generation_jobs j ON j.id=s.job_id WHERE s.cycle_id=c.id AND s.sample_index<4 ORDER BY s.sample_index) x) AS sample_outputs
        FROM ai_copy_automation_cycles c JOIN ai_copy_policy_versions a ON a.id=c.baseline_policy_id LEFT JOIN ai_copy_policy_versions b ON b.id=c.candidate_policy_id
        JOIN ai_copy_knowledge_versions k ON k.id=c.knowledge_version_id LEFT JOIN email_copy_experiments e ON e.id=c.experiment_id
        WHERE c.org_id=${user.orgId} AND (${workspaceId}=0 OR c.workspace_id=${workspaceId}) ORDER BY c.id DESC LIMIT 30`;
        return {
            settings,
            cycles,
            finalApplication: "manual",
            dailyCalls: 180,
            dailyTokens: 300000,
        };
    });
const inputSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("configure"),
        workspaceId: z.number().int().positive(),
        enabled: z.boolean(),
        experimentMode: z.enum(["auto", "manual"]),
    }),
    z.object({
        action: z.enum(["apply", "draft_experiment", "decline", "refresh"]),
        cycleId: z.number().int().positive(),
    }),
]);
export const POST = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const input = inputSchema.parse(await req.json()),
            actor = { orgId: user.orgId, userId: user.userId, now: new Date() };
        if (input.action === "configure") return configureCopyAutomation(conn, input, actor);
        const [cycle] = await conn<
            AutomationCycle[]
        >`SELECT * FROM ai_copy_automation_cycles WHERE id=${input.cycleId} AND org_id=${user.orgId}`;
        if (!cycle) throw new CopyActionError("자동 준비 기록을 찾을 수 없습니다.");
        if (input.action === "apply")
            return applyAutomationCycle(
                conn,
                cycle,
                actor,
                await connectedReplyAvailable(actor.orgId, cycle.workspace_id, actor.now),
            );
        if (input.action === "draft_experiment") {
            if (cycle.stage !== "ready_for_experiment")
                throw new CopyActionError("자동 평가를 통과한 후보만 실험을 준비할 수 있습니다.");
            return prepareAutomaticExperiment(conn, cycle, actor.now, false, false);
        }
        if (input.action === "decline") {
            if (["applied", "declined"].includes(cycle.stage))
                throw new CopyActionError("이미 종료된 준비 기록입니다.");
            if (cycle.experiment_id && cycle.experiment_owned)
                await changeExperimentState(conn, {
                    ...actor,
                    id: cycle.experiment_id,
                    action: "close",
                    pendingMode: "continue",
                    reason: "관리자가 기존 지침을 유지하고 자동 비교를 종료했습니다.",
                });
            await conn`UPDATE ai_copy_automation_cycles SET stage='declined',reason='관리자가 기존 지침 유지를 선택했습니다.',updated_at=now() WHERE id=${cycle.id} AND stage<>'applied'`;
            return { declined: true };
        }
        // 다시 준비: 바로 실행하고, 보류된 회차라면 7일 대기 없이 새 회차를 열도록 last_error를 비운다(UX-246).
        await conn`UPDATE ai_copy_automation_settings SET next_run_at=${actor.now.toISOString()},last_error=NULL WHERE id=${cycle.setting_id} AND org_id=${user.orgId}`;
        return { scheduled: true };
    });
