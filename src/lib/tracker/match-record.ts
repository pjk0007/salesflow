import { db } from "@/lib/db";
import { trackerVisitors, emailClickLogs, emailSendLogs } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * click_id로 emailSendLogs.recordId를 찾아 visitor에 연결.
 * 이미 recordId가 있으면 아무것도 안 함.
 */
export async function linkVisitorByClickId(
    visitorPk: number,
    clickId: string,
): Promise<{ recordId: number | null; email: string | null; name: string | null }> {
    const visitor = await db.query.trackerVisitors.findFirst({
        where: eq(trackerVisitors.id, visitorPk),
    });
    if (!visitor || visitor.recordId) {
        return {
            recordId: visitor?.recordId ?? null,
            email: visitor?.email ?? null,
            name: visitor?.name ?? null,
        };
    }

    // emailClickLogs join emailSendLogs
    const [match] = await db
        .select({
            recordId: emailSendLogs.recordId,
            recipientEmail: emailSendLogs.recipientEmail,
        })
        .from(emailClickLogs)
        .innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
        .where(eq(emailClickLogs.clickId, clickId))
        .limit(1);

    if (!match || !match.recordId) {
        return { recordId: null, email: visitor.email ?? null, name: visitor.name ?? null };
    }

    await db
        .update(trackerVisitors)
        .set({
            recordId: match.recordId,
            email: visitor.email ?? match.recipientEmail,
        })
        .where(eq(trackerVisitors.id, visitorPk));

    return {
        recordId: match.recordId,
        email: visitor.email ?? match.recipientEmail,
        name: visitor.name,
    };
}

/**
 * 폼 제출 등으로 record가 생성된 후, 같은 워크스페이스의 트래커 사이트에서
 * 해당 visitor_id를 찾아 record_id를 채움.
 */
export async function linkVisitorByFormSubmit(input: {
    workspaceId: number;
    visitorId: string;
    recordId: number;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
}): Promise<void> {
    const { trackerSites } = await import("@/lib/db/schema");
    const site = await db.query.trackerSites.findFirst({
        where: and(
            eq(trackerSites.workspaceId, input.workspaceId),
            eq(trackerSites.isActive, 1),
        ),
    });
    if (!site) return;

    const visitor = await db.query.trackerVisitors.findFirst({
        where: and(
            eq(trackerVisitors.siteId, site.id),
            eq(trackerVisitors.visitorId, input.visitorId),
        ),
    });
    if (!visitor) return;

    await db
        .update(trackerVisitors)
        .set({
            recordId: input.recordId,
            email: input.email ?? visitor.email,
            name: input.name ?? visitor.name,
            phone: input.phone ?? visitor.phone,
            updatedAt: new Date(),
        })
        .where(eq(trackerVisitors.id, visitor.id));
}
