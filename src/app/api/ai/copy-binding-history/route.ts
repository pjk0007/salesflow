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
        const events =
            await conn`SELECT e.*,u.name AS changed_by_name FROM ai_copy_binding_events e LEFT JOIN users u ON u.id=e.changed_by WHERE e.org_id=${user.orgId} AND (${cursor}=0 OR e.id<${cursor}) ORDER BY e.id DESC LIMIT 51`;
        return {
            events: events.slice(0, 50),
            nextCursor: events.length > 50 ? events[49].id : null,
        };
    });
