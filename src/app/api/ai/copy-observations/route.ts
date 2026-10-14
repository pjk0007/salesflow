import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi } from "@/lib/ai-copy/api";
import { loadCopyObservations } from "@/lib/ai-copy/observations";

export const GET = (req: NextRequest) =>
    copyAdminApi(req, (conn, user) =>
        loadCopyObservations(conn, {
            orgId: user.orgId,
            workspaceId: z.coerce
                .number()
                .int()
                .nonnegative()
                .parse(req.nextUrl.searchParams.get("workspaceId") ?? 0),
            days: z.coerce
                .number()
                .int()
                .min(14)
                .max(90)
                .parse(req.nextUrl.searchParams.get("days") ?? 30),
            now: new Date(),
            internalDomains: (process.env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","),
        }),
    );
