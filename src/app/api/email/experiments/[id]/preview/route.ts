import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { previewExperiment } from "@/lib/email-experiments/preview";
import type { Experiment } from "@/lib/email-experiments/types";
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = z.coerce
            .number()
            .int()
            .positive()
            .parse((await context.params).id);
        const [experiment] = await conn<
            Experiment[]
        >`SELECT * FROM email_copy_experiments WHERE id=${id} AND org_id=${user.orgId}`;
        if (!experiment) throw new CopyActionError("실험을 찾을 수 없습니다.");
        return previewExperiment(conn, {
            orgId: user.orgId,
            experiment,
            now: new Date(),
            internalDomains: (process.env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","),
        });
    });
