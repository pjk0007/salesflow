import { eq } from "drizzle-orm";
import {
    db,
    customerAiSettings,
    inboxOperationsSettings,
    type inboxChannels,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { supportWorkerEnabled } from "@/lib/customer-ai/worker-policy";
import { getAiClient } from "@/lib/ai/client";
import { chatKnowledge } from "@/lib/customer-ai/catalog";
import { messengerSettingsSchema, notificationWorkerEnabled } from "./rules";
import { notificationSender } from "./transport";
export async function publicMessengerSettings(
    channel: typeof inboxChannels.$inferSelect,
    exec: DbExec = db,
) {
    const settings = messengerSettingsSchema.parse(
        channel.messengerSettings ?? {},
    );
    if (!settings.enabled)
        return {
            ...settings,
            aiAvailable: false,
            emailNotifications: false,
            weekly: [],
        };
    const [ai] = await exec
        .select()
        .from(customerAiSettings)
        .where(eq(customerAiSettings.workspaceId, channel.workspaceId));
    const [operations] = await exec
        .select()
        .from(inboxOperationsSettings)
        .where(eq(inboxOperationsSettings.channelId, channel.id));
    const facts = ai?.knowledgeVersionId
        ? await chatKnowledge(
              channel.orgId,
              channel.workspaceId,
              ai.knowledgeVersionId,
              exec,
          )
        : null;
    const consultation = settings.consultationUrl;
    return {
        ...settings,
        consultationUrl:
            consultation &&
            channel.allowedOrigins.includes(new URL(consultation).origin)
                ? consultation
                : "",
        aiAvailable:
            ai?.mode === "reply" &&
            !!facts?.sources.length &&
            supportWorkerEnabled(process.env, channel.workspaceId) &&
            !!getAiClient(ai.model),
        emailNotifications:
            settings.emailNotifications &&
            notificationWorkerEnabled() &&
            !!(await notificationSender(channel.orgId, exec)),
        weekly: operations?.policy.calendar.weekly ?? [],
        timezone: operations?.policy.calendar.timezone ?? "Asia/Seoul",
    };
}
