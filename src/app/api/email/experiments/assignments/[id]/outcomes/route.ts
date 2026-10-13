import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { appendOutcomeRevision } from "@/lib/email-experiments/results";
const idFrom = async (context: { params: Promise<{ id: string }> }) =>
    z.coerce
        .number()
        .int()
        .positive()
        .parse((await context.params).id);
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = await idFrom(context);
        const [assignment] =
            await conn`SELECT * FROM email_copy_assignments WHERE id=${id} AND org_id=${user.orgId}`;
        if (!assignment) throw new CopyActionError("배정 고객을 찾을 수 없습니다.");
        const replies =
            await conn`SELECT id,subject,excerpt,received_at,kind FROM email_replies WHERE org_id=${user.orgId} AND workspace_id=${assignment.workspace_id} AND kind='human' AND match_status='matched'
        AND (send_log_id=${assignment.send_log_id} OR root_log_id=${assignment.send_log_id}) ORDER BY received_at DESC LIMIT 100`;
        const history =
            await conn`SELECT o.*,u.name AS recorded_by_name FROM email_copy_outcome_revisions o LEFT JOIN users u ON u.id=o.recorded_by WHERE assignment_id=${id} AND o.org_id=${user.orgId} ORDER BY o.recorded_at DESC,o.id DESC LIMIT 200`;
        return { assignment, replies, history };
    });
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = await idFrom(context),
            body = await req.json();
        return appendOutcomeRevision(
            conn,
            { ...body, assignmentId: id },
            { orgId: user.orgId, userId: user.userId, now: new Date() },
        );
    });
