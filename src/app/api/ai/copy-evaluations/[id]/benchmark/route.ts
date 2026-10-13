import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { createBenchmark, refreshBenchmark } from "@/lib/ai-copy/benchmark";
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const runs = await conn<
            { id: number }[]
        >`SELECT id FROM ai_copy_benchmark_runs WHERE evaluation_run_id=${id} AND org_id=${user.orgId} ORDER BY id DESC LIMIT 1`;
        return runs[0] ? refreshBenchmark(conn, user.orgId, runs[0].id) : null;
    });
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const body = z
            .object({
                action: z.enum(["start", "cancel"]),
                region: z.string().trim().min(2).max(100).optional(),
            })
            .parse(await req.json());
        if (body.action === "start")
            return createBenchmark(conn, {
                orgId: user.orgId,
                runId: id,
                userId: user.userId,
                region: body.region ?? "",
                now: new Date(),
            });
        const [run] = await conn<
            { id: number }[]
        >`UPDATE ai_copy_benchmark_runs SET state='cancelled' WHERE org_id=${user.orgId} AND evaluation_run_id=${id} AND state='running' RETURNING id`;
        if (!run) throw new CopyActionError("진행 중인 부하 측정이 없습니다.");
        await conn`UPDATE ai_copy_generation_jobs SET state='cancelled',reason='부하 측정 취소',lease_token=NULL,lease_until=NULL WHERE id IN(SELECT job_id FROM ai_copy_benchmark_cases WHERE run_id=${run.id})`;
        return { cancelled: true };
    });
