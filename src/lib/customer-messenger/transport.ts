import { and, eq, asc, desc } from "drizzle-orm";
import { db, emailConfigs, emailSenderProfiles } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { NhnEmailClient } from "@/lib/nhn-email";
export async function notificationSender(orgId: string, exec: DbExec = db) {
    const [config] = await exec
        .select()
        .from(emailConfigs)
        .where(
            and(eq(emailConfigs.orgId, orgId), eq(emailConfigs.isActive, 1)),
        );
    if (!config?.appKey || !config.secretKey) return null;
    const [sender] = await exec
        .select()
        .from(emailSenderProfiles)
        .where(
            and(
                eq(emailSenderProfiles.orgId, orgId),
                eq(emailSenderProfiles.isPaused, false),
            ),
        )
        .orderBy(
            desc(emailSenderProfiles.isDefault),
            asc(emailSenderProfiles.id),
        )
        .limit(1);
    const address = config.fromEmail || sender?.fromEmail;
    return address ? { config, address } : null;
}
export const escapeEmailHtml = (s: string) =>
    s.replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c]!,
    );
export async function sendNotificationMail(
    input: {
        orgId: string;
        name: string;
        email: string;
        subject: string;
        body: string;
    },
    exec: DbExec = db,
) {
    const sender = await notificationSender(input.orgId, exec);
    if (!sender) throw new Error("notification_sender_unavailable");
    const result = await new NhnEmailClient(
        sender.config.appKey,
        sender.config.secretKey,
        { timeoutMs: 30000 },
    ).sendEachMail({
        senderAddress: sender.address,
        senderName: input.name,
        title: input.subject,
        body: input.body,
        receiverList: [{ receiveMailAddr: input.email, receiveType: "MRT0" }],
    });
    if (
        !result.header.isSuccessful ||
        !result.data?.requestId ||
        result.data.results?.some((r) => r.resultCode !== 0)
    )
        throw new Error("notification_delivery_unconfirmed");
    return result.data.requestId;
}
