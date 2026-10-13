import { NextRequest } from "next/server";
import { z } from "zod";
import { copyAdminApi, CopyActionError } from "@/lib/ai-copy/api";
import { changeExperimentState, startExperiment } from "@/lib/email-experiments/repository";
import { adoptExperiment, advanceExperimentLifecycles } from "@/lib/email-experiments/actions";
import { loadExperimentResults } from "@/lib/email-experiments/results";
import { connectedReplyAvailable } from "@/lib/email-experiments/runtime";
import { previewExperiment } from "@/lib/email-experiments/preview";
import type { Experiment } from "@/lib/email-experiments/types";
const idFrom = async (context: { params: Promise<{ id: string }> }) =>
    z.coerce
        .number()
        .int()
        .positive()
        .parse((await context.params).id);
export const GET = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = await idFrom(context),
            now = new Date();
        await advanceExperimentLifecycles(conn, now, user.orgId);
        const [experiment] = await conn<
            Experiment[]
        >`SELECT * FROM email_copy_experiments WHERE id=${id} AND org_id=${user.orgId}`;
        if (!experiment) throw new CopyActionError("실험을 찾을 수 없습니다.");
        return loadExperimentResults(conn, {
            orgId: user.orgId,
            id,
            asOf: now,
            connectedReplyAvailable: await connectedReplyAvailable(
                user.orgId,
                experiment.workspace_id,
                now,
            ),
        });
    });
export const POST = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
    copyAdminApi(req, async (conn, user) => {
        const id = await idFrom(context),
            now = new Date();
        const body = z
            .object({
                action: z.enum([
                    "start",
                    "pause",
                    "resume",
                    "close_enrollment",
                    "invalidate",
                    "close",
                    "adopt",
                ]),
                pendingMode: z.enum(["continue", "hold"]).default("hold"),
                reason: z.string().trim().max(1000).default(""),
                acknowledgeForecast: z.boolean().default(false),
            })
            .parse(await req.json());
        const [experiment] = await conn<
            Experiment[]
        >`SELECT * FROM email_copy_experiments WHERE id=${id} AND org_id=${user.orgId}`;
        if (!experiment) throw new CopyActionError("실험을 찾을 수 없습니다.");
        const available = await connectedReplyAvailable(user.orgId, experiment.workspace_id, now);
        if (body.action === "adopt")
            return adoptExperiment(conn, {
                orgId: user.orgId,
                userId: user.userId,
                id,
                now,
                connectedReplyAvailable: available,
            });
        if (body.action === "start") {
            const preview = await previewExperiment(conn, {
                orgId: user.orgId,
                experiment,
                now,
                internalDomains: (process.env.JOURNEY_ALERT_INTERNAL_DOMAINS ?? "").split(","),
            });
            if (preview.warnings.length && !body.acknowledgeForecast)
                throw new CopyActionError(
                    "표본·수집 기간 미리보기의 제약을 확인한 뒤 시작해 주세요.",
                );
            return startExperiment(conn, {
                orgId: user.orgId,
                userId: user.userId,
                id,
                now,
                connectedReplyAvailable: available,
            });
        }
        return changeExperimentState(conn, {
            orgId: user.orgId,
            userId: user.userId,
            id,
            now,
            action: body.action,
            pendingMode: body.pendingMode,
            reason: body.reason,
        });
    });
