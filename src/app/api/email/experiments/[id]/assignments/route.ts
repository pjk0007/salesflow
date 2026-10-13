import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const cursor = z.coerce
                .number()
                .int()
                .nonnegative()
                .parse(req.nextUrl.searchParams.get("cursor") ?? 0),
            search = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
        const assignments =
            await conn`SELECT a.*,j.state AS generation_state,j.reason AS generation_reason,
        (SELECT count(*)::int FROM email_replies r WHERE r.org_id=a.org_id AND r.kind='human' AND r.match_status='matched' AND (r.send_log_id=a.send_log_id OR r.root_log_id=a.send_log_id)) AS human_replies
        FROM email_copy_assignments a JOIN email_copy_experiments e ON e.id=a.experiment_id LEFT JOIN ai_copy_generation_jobs j ON j.id=a.generation_job_id
        WHERE e.id=${id} AND a.org_id=${user.orgId} AND (${cursor}=0 OR a.id>${cursor}) AND (${search}='' OR a.normalized_email ILIKE ${`%${search}%`}) ORDER BY a.id LIMIT 101`;
        return {
            assignments: assignments.slice(0, 100),
            nextCursor: assignments.length > 100 ? assignments[99].id : null,
        };
    });
