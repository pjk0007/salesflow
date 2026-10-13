import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { createExperiment } from "@/lib/email-experiments/repository";
export const GET = (req: NextRequest) =>
    copyAdminApi(req, async (conn, user) => {
        const cursor = z.coerce
            .number()
            .int()
            .nonnegative()
            .parse(req.nextUrl.searchParams.get("cursor") ?? 0);
        const experiments =
            await conn`SELECT * FROM email_copy_experiments WHERE org_id=${user.orgId} AND (${cursor}=0 OR id<${cursor}) ORDER BY id DESC LIMIT 21`;
        const members =
            await conn`SELECT DISTINCT u.id,u.name FROM users u JOIN organization_members m ON m.user_id=u.id AND m.organization_id=${user.orgId} WHERE u.is_active=1 ORDER BY u.name`;
        return {
            experiments: experiments.slice(0, 20),
            nextCursor: experiments.length > 20 ? experiments[19].id : null,
            members,
        };
    });
export const POST = (req: NextRequest) =>
    copyAdminApi(req, (conn, user) =>
        req
            .json()
            .then((body) =>
                createExperiment(conn, body, { orgId: user.orgId, userId: user.userId }),
            ),
    );
