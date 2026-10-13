import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
export const GET = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const cursor = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("cursor") ?? 0);
        const workspaceId = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("workspaceId") ?? 0);
        const origin = z
            .enum(["all", "operational", "evaluation", "benchmark", "replacement"])
            .parse(req.nextUrl.searchParams.get("origin") ?? "operational");
        const jobs =
            await conn`SELECT j.id,j.workspace_id,j.purpose,j.origin,j.state,j.reason,j.attempts,j.policy_version_id,j.knowledge_version_id,j.assignment_id,j.send_log_id,j.eligible_at,j.ready_at,j.created_at,
        (SELECT sum(a.cost_krw) FROM ai_copy_generation_attempts a WHERE a.job_id=j.id) AS cost_krw,
        NOT EXISTS(SELECT 1 FROM ai_copy_generation_attempts a WHERE a.job_id=j.id AND (a.cost_krw IS NULL OR NOT a.usage_known)) AND j.attempts>0 AS cost_known
        FROM ai_copy_generation_jobs j WHERE j.org_id=${user.orgId} AND (${workspaceId}=0 OR j.workspace_id=${workspaceId}) AND (${origin}='all' OR j.origin=${origin}) AND (${cursor}=0 OR j.id<${cursor}) ORDER BY j.id DESC LIMIT 51`;
        return { jobs: jobs.slice(0, 50), nextCursor: jobs.length > 50 ? jobs[49].id : null };
    });
