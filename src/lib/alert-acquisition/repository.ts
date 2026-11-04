import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db, records, trackerSessions, trackerSites, trackerVisitors, visitorRecordLinks,
    emailSendLogs, emailClickLogs, inboxConversations } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { mailAcquisition, unknownAcquisition, websiteAcquisition, senderDomain, optionalAcquisition, type AlertAcquisition } from "./rules";

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
type Scope = { orgId: string; workspaceId: number; at: Date };
type Session = typeof trackerSessions.$inferSelect;
type Conversation = Pick<typeof inboxConversations.$inferSelect, "orgId" | "recordId" | "email" | "journeyContext">;

/** 부가 조회만 짧은 제한을 적용한다. 실패한 트랜잭션은 원래 알림 전송과 분리한다. */
export const lookupAcquisition = (exec: DbExec, load: (tx: DbExec) => Promise<AlertAcquisition>) =>
    optionalAcquisition(() => exec.transaction(async tx => {
        await tx.execute(sql`SET LOCAL statement_timeout = '1500ms'`);
        return load(tx);
    }));

async function clickedMail(scope: Scope, sessions: Session[], exec: DbExec) {
    const ids = [...new Set(sessions.flatMap(s => s.clickId ? [s.clickId] : []))];
    if (!ids.length) return [];
    const rows = await exec.select({ clickId: emailClickLogs.clickId, sender: emailSendLogs.senderEmail, recordId: records.id, clickedAt: emailClickLogs.clickedAt })
        .from(emailClickLogs).innerJoin(emailSendLogs, eq(emailSendLogs.id, emailClickLogs.sendLogId))
        .innerJoin(records, eq(records.id, emailSendLogs.recordId)).where(and(
            inArray(emailClickLogs.clickId, ids), eq(emailClickLogs.orgId, scope.orgId), eq(emailClickLogs.isBot, false),
            eq(emailSendLogs.orgId, scope.orgId), eq(emailSendLogs.status, "sent"),
            eq(records.orgId, scope.orgId), eq(records.workspaceId, scope.workspaceId),
            lte(emailClickLogs.clickedAt, scope.at), gte(emailClickLogs.clickedAt, new Date(scope.at.getTime() - LOOKBACK_MS)),
            sql`${emailSendLogs.sentAt} <= ${emailClickLogs.clickedAt}`,
        )).limit(21);
    return rows.filter(row => sessions.some(session => session.clickId === row.clickId
        && row.clickedAt.getTime() >= session.startedAt.getTime() - 30 * 60_000
        && row.clickedAt.getTime() <= session.startedAt.getTime() + 30_000));
}

export async function conversationAcquisition(scope: Scope, chat: Conversation, exec: DbExec = db): Promise<AlertAcquisition> {
    if (chat.orgId !== scope.orgId) return unknownAcquisition();
    const context = chat.journeyContext;
    // 첫 메시지 직후 SDK가 경로를 첨부할 수 있어 연결 시각만 30초 여유를 둔다.
    if (context && context.orgId === scope.orgId && context.workspaceId === scope.workspaceId
        && Date.parse(context.linkedAt) <= scope.at.getTime() + 30_000) {
        const [session] = await exec.select({ session: trackerSessions }).from(trackerSessions)
            .innerJoin(trackerSites, eq(trackerSites.id, trackerSessions.siteId))
            .innerJoin(trackerVisitors, eq(trackerVisitors.id, trackerSessions.visitorId)).where(and(
                eq(trackerSessions.id, context.sessionId), eq(trackerSessions.visitorId, context.visitorId),
                eq(trackerSites.id, context.siteId), eq(trackerSites.orgId, scope.orgId),
                eq(trackerSites.workspaceId, scope.workspaceId), eq(trackerSites.isActive, 1),
                eq(trackerVisitors.orgId, scope.orgId), eq(trackerVisitors.siteId, context.siteId),
                lte(trackerSessions.startedAt, scope.at), gte(trackerSessions.startedAt, new Date(scope.at.getTime() - LOOKBACK_MS)),
            )).limit(1);
        if (session) {
            const [mail] = await clickedMail(scope, [session.session], exec);
            if (mail && (!chat.recordId || mail.recordId === chat.recordId)) return mailAcquisition(mail.sender, true);
            if (mail) return unknownAcquisition("상담 레코드와 메일 클릭의 연결 대상이 달라 확인 필요");
            return websiteAcquisition(session.session, true);
        }
    }
    return recordAcquisition({ ...scope, recordId: chat.recordId, email: chat.email }, exec);
}

/** 이메일·대표 visitor 연결은 수신자 본인이나 이번 접수의 직접 연결 증거로 승격하지 않는다. */
export async function recordAcquisition(scope: Scope & { recordId: number | null; email?: string | null }, exec: DbExec = db): Promise<AlertAcquisition> {
    const [record] = scope.recordId ? await exec.select({ data: records.data }).from(records).where(and(
        eq(records.id, scope.recordId), eq(records.orgId, scope.orgId), eq(records.workspaceId, scope.workspaceId),
    )).limit(1) : [];
    if (scope.recordId && !record) return unknownAcquisition();
    const emailValue = scope.email ?? record?.data?.email;
    const email = typeof emailValue === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim()) ? emailValue.trim().toLowerCase() : null;
    if (!scope.recordId && !email) return unknownAcquisition();
    const since = new Date(scope.at.getTime() - LOOKBACK_MS);
    const rows = await exec.select({ session: trackerSessions }).from(trackerSessions)
        .innerJoin(trackerSites, eq(trackerSites.id, trackerSessions.siteId))
        .innerJoin(trackerVisitors, eq(trackerVisitors.id, trackerSessions.visitorId))
        .leftJoin(visitorRecordLinks, and(eq(visitorRecordLinks.visitorId, trackerVisitors.id),
            eq(visitorRecordLinks.orgId, scope.orgId), scope.recordId ? eq(visitorRecordLinks.recordId, scope.recordId) : sql`false`))
        .where(and(eq(trackerSites.orgId, scope.orgId), eq(trackerSites.workspaceId, scope.workspaceId), eq(trackerSites.isActive, 1),
            eq(trackerVisitors.orgId, scope.orgId), eq(trackerVisitors.siteId, trackerSites.id),
            gte(trackerSessions.startedAt, since), lte(trackerSessions.startedAt, scope.at),
            or(scope.recordId ? eq(trackerVisitors.recordId, scope.recordId) : undefined,
                scope.recordId ? eq(visitorRecordLinks.recordId, scope.recordId) : undefined,
                email ? sql`lower(trim(${trackerVisitors.email})) = ${email}` : undefined),
        )).orderBy(desc(trackerSessions.startedAt), desc(trackerSessions.id)).limit(21);
    if (!rows.length) return unknownAcquisition();
    if (rows.length > 20) return unknownAcquisition("연결 후보가 많아 경로를 특정할 수 없음");
    const sessions = rows.map(row => row.session);
    const clicked = await clickedMail(scope, [sessions[0]], exec);
    const domains = new Set(clicked.map(row => senderDomain(row.sender) ?? ""));
    if (domains.size > 1) return unknownAcquisition("서로 다른 메일 발신 경로가 연결돼 확인 필요");
    if (clicked.length) return mailAcquisition(clicked[0].sender, false);
    const website = websiteAcquisition(sessions[0], false);
    if (website.certainty !== "unknown" && !website.channel.startsWith("메일")) return website;
    if (!email) return website;
    // 발송만으로 추정하지 않는다. 같은 이메일의 최근 방문도 있어야 한다.
    const sends = await exec.select({ sender: emailSendLogs.senderEmail }).from(emailSendLogs)
        .innerJoin(records, eq(records.id, emailSendLogs.recordId)).where(and(
            eq(emailSendLogs.orgId, scope.orgId), eq(records.orgId, scope.orgId), eq(records.workspaceId, scope.workspaceId),
            eq(emailSendLogs.status, "sent"), sql`lower(trim(${emailSendLogs.recipientEmail})) = ${email}`,
            gte(emailSendLogs.sentAt, since), lte(emailSendLogs.sentAt, sessions[0].startedAt),
        )).orderBy(desc(emailSendLogs.sentAt)).limit(21);
    const sendDomains = new Set(sends.map(row => senderDomain(row.sender) ?? ""));
    if (sends.length > 20 || sendDomains.size > 1) return unknownAcquisition("최근 메일 발신 경로가 여러 개여서 특정할 수 없음");
    return sends.length ? mailAcquisition(sends[0].sender, false) : website;
}
