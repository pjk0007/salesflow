import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { refreshEvaluationReport } from "@/lib/ai-copy/evaluations";
import { processCopyEvaluations } from "@/lib/ai-copy/worker";
import { copyTransaction } from "@/lib/ai-copy/generation";
export const maxDuration = 60;
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const [run] =
            await conn`SELECT * FROM ai_copy_evaluation_runs WHERE id=${id} AND org_id=${user.orgId}`;
        if (!run) throw new CopyActionError("평가를 찾을 수 없습니다.");
        const report = await refreshEvaluationReport(conn, user.orgId, id);
        return { run, report };
    });
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const body = z
            .object({ action: z.enum(["process", "cancel", "resume_quota"]) })
            .parse(await req.json());
        if (body.action === "process")
            return processCopyEvaluations({ orgId: user.orgId, runId: id }, conn);
        if (body.action === "resume_quota")
            return copyTransaction(conn, async () => {
                const [run] =
                    await conn`SELECT id FROM ai_copy_evaluation_runs WHERE id=${id} AND org_id=${user.orgId} AND state IN('review','running') FOR UPDATE`;
                if (!run) throw new CopyActionError("재개할 수 있는 평가가 아닙니다.");
                const jobs =
                    await conn`UPDATE ai_copy_generation_jobs SET state='pending',reason=NULL,eligible_at=now(),retry_at=NULL,updated_at=now()
            WHERE org_id=${user.orgId} AND state='held' AND reason='token_quota' AND id IN(SELECT job_id FROM ai_copy_evaluation_cases WHERE run_id=${id}) RETURNING id`;
                if (!jobs.length)
                    throw new CopyActionError("사용량 한도로 보류된 평가 문구가 없습니다.");
                await conn`UPDATE ai_copy_evaluation_runs SET state='running',completed_at=NULL WHERE id=${id}`;
                return { resumed: jobs.length };
            });
        return copyTransaction(conn, async () => {
            const [run] =
                await conn`UPDATE ai_copy_evaluation_runs SET state='cancelled' WHERE id=${id} AND org_id=${user.orgId} AND state IN ('pending','running','review') RETURNING id`;
            if (!run) throw new CopyActionError("취소할 수 있는 평가가 아닙니다.");
            await conn`UPDATE ai_copy_generation_jobs SET state='cancelled',reason='평가 취소',lease_token=NULL,lease_until=NULL WHERE id IN(SELECT job_id FROM ai_copy_evaluation_cases WHERE run_id=${id})`;
            return { cancelled: true };
        });
    });
