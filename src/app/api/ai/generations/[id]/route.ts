import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { copyTransaction, generateStoredCopy, CopyDeferredError } from "@/lib/ai-copy/generation";
import {
    requestCopyReplacement,
    finalizeCopyReplacement,
    cancelCopyJob,
} from "@/lib/ai-copy/revisions";
import { generationDeps } from "@/lib/ai-copy/runtime";
export const maxDuration = 60;
const idFrom = async (context: { params: Promise<{ id: string }> }) =>
    z.coerce
        .number()
        .int()
        .positive()
        .parse((await context.params).id);
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = await idFrom(context);
        const [job] =
            await conn`SELECT * FROM ai_copy_generation_jobs WHERE id=${id} AND org_id=${user.orgId}`;
        if (!job) throw new CopyActionError("작업을 찾을 수 없습니다.");
        const attempts =
            await conn`SELECT * FROM ai_copy_generation_attempts WHERE job_id=${id} AND org_id=${user.orgId} ORDER BY attempt_number`;
        return { job, attempts };
    });
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = await idFrom(context),
            body = z
                .object({
                    action: z.enum(["cancel", "resume", "regenerate"]),
                    requestId: z.uuid().optional(),
                    policyVersionId: z.number().int().positive().optional(),
                    knowledgeVersionId: z.number().int().positive().optional(),
                })
                .parse(await req.json());
        if (body.action === "regenerate") {
            if (!body.requestId || !body.policyVersionId || !body.knowledgeVersionId)
                throw new CopyActionError("새로 적용할 승인 버전을 선택해 주세요.");
            const job = await requestCopyReplacement(conn, {
                orgId: user.orgId,
                userId: user.userId,
                id,
                requestId: body.requestId,
                policyVersionId: body.policyVersionId,
                knowledgeVersionId: body.knowledgeVersionId,
                now: new Date(),
            });
            try {
                await generateStoredCopy(conn, { id: job.id, orgId: user.orgId }, generationDeps());
            } catch (error) {
                if (!(error instanceof CopyDeferredError)) throw error;
            }
            await finalizeCopyReplacement(conn, { orgId: user.orgId, id: job.id });
            return { replacementJobId: job.id, appliesTo: "selected_unsent_job" };
        }
        if (body.action === "cancel") return cancelCopyJob(conn, { id, orgId: user.orgId });
        return copyTransaction(conn, async () => {
            const [job] =
                await conn`SELECT * FROM ai_copy_generation_jobs WHERE id=${id} AND org_id=${user.orgId} FOR UPDATE`;
            if (!job) throw new CopyActionError("작업을 찾을 수 없습니다.");
            if (job.send_log_id)
                throw new CopyActionError("발송이 시작된 작업은 이 화면에서 변경할 수 없습니다.");
            if (job.state !== "held" || job.reason !== "token_quota")
                throw new CopyActionError(
                    "사용량 한도로 보류된 작업만 재개할 수 있습니다. 문제 문구는 새 버전으로 다시 준비해 주세요.",
                );
            if (job.origin === "benchmark")
                throw new CopyActionError(
                    "중단된 부하 측정은 사용량을 확인한 뒤 새 측정으로 진행해 주세요.",
                );
            await conn`UPDATE ai_copy_generation_jobs SET state='pending',reason=NULL,eligible_at=now(),retry_at=NULL,updated_at=now() WHERE id=${id}`;
            if (job.origin === "evaluation")
                await conn`UPDATE ai_copy_evaluation_runs SET state='running' WHERE id IN(SELECT run_id FROM ai_copy_evaluation_cases WHERE job_id=${id}) AND org_id=${user.orgId} AND state='review'`;
            return { state: "pending" };
        });
    });
