import { createHash } from "node:crypto";
import { z } from "zod";
import { chatWebhookProblem } from "@/lib/google-chat";
import { isDevelopmentPreviewRuntime } from "@/lib/development-runtime";

const routeInput = z.object({
    orgId: z.uuid(), workspaceId: z.number().int().positive(),
    channelId: z.number().int().positive(),
    webhook: z.string().refine(value => !chatWebhookProblem(value)),
}).strict();
export type ChatAlertRoute = z.infer<typeof routeInput>;
export function chatAlertRoutes(env: Record<string, string | undefined> = process.env): ChatAlertRoute[] {
    if (env.INBOX_CHAT_ALERTS !== "on" || isDevelopmentPreviewRuntime(env)) return [];
    try {
        const routes = z.array(routeInput).max(20).parse(JSON.parse(env.INBOX_CHAT_ALERT_ROUTES ?? "[]"));
        if (new Set(routes.map(route => `${route.orgId}:${route.channelId}`)).size !== routes.length) return [];
        return routes;
    } catch { return []; }
}
export const routeFingerprint = (route: ChatAlertRoute) =>
    createHash("sha256").update(JSON.stringify([route.orgId, route.workspaceId, route.channelId, route.webhook])).digest("hex");
export const chatAlertWorkerEnabled = () => process.env.NODE_ENV === "production" && chatAlertRoutes().length > 0;
