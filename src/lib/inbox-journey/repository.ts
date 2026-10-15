import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
    db, inboxChannels, inboxConversations, crmContacts, records, trackerSites,
    trackerVisitors, trackerSessions, trackerEvents, visitorRecordLinks,
    emailSendLogs, emailClickLogs, alimtalkSendLogs, recordEvents,
} from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import type { JWTPayload } from "@/types";
import { ownedConversation, publicChannel, visitorFileScope } from "@/lib/inbox/repository";
import { InboxError } from "@/lib/inbox/errors";
import { loadInboxJourney } from "@/lib/inbox/journey";
import { normalizeTrackerEvents } from "@/lib/journey/tracker-journey";
import { buildTrackerLabelMaps } from "@/lib/journey/tracker-label-maps";
import type { JourneyEvent } from "@/components/journey/types";
import { matchesDomain } from "@/lib/tracker/domain-match";
import { verifyJourneyContext, type StoredJourneyContext } from "./context";

export async function attachJourneyContext(key: string, token: string, raw: unknown, exec: DbExec = db) {
    const input = z.object({ journeyToken: z.string().max(4096), conversationId: z.string().uuid().optional() }).parse(raw);
    let context;
    try { context = verifyJourneyContext(input.journeyToken); }
    catch { return { linked: false, reason: "context_expired" }; }
    return exec.transaction(async tx => {
        const channel = await publicChannel(key, tx);
        if (context.orgId !== channel.orgId || context.workspaceId !== channel.workspaceId ||
            !channel.allowedOrigins.includes(context.origin))
            throw new InboxError("이 사업의 방문 경로만 연결할 수 있습니다.", 403);
        const selection = { conversationId: input.conversationId, readHistory: true };
        const scope = await visitorFileScope(key, token, tx, selection);
        if (!scope.conversationId) return { linked: false, reason: "no_conversation" };
        if (scope.readOnly) throw new InboxError("이전 상담에는 방문 경로를 추가할 수 없습니다.", 409);
        const [site] = await tx.select().from(trackerSites).where(and(
            eq(trackerSites.id, context.siteId), eq(trackerSites.orgId, channel.orgId),
            eq(trackerSites.workspaceId, channel.workspaceId), eq(trackerSites.isActive, 1),
        ));
        if (!site || !matchesDomain(context.origin, site.domains))
            throw new InboxError("이 사업의 활성 사이트 경로가 아닙니다.", 403);
        const [session] = await tx.select({ id: trackerSessions.id }).from(trackerSessions)
            .innerJoin(trackerVisitors, eq(trackerVisitors.id, trackerSessions.visitorId))
            .where(and(eq(trackerSessions.id, context.sessionId), eq(trackerSessions.siteId, site.id),
                eq(trackerSessions.visitorId, context.visitorId), eq(trackerVisitors.orgId, channel.orgId),
                eq(trackerVisitors.siteId, site.id)));
        if (!session) throw new InboxError("방문 경로를 찾을 수 없습니다.", 404);
        await tx.select({ id: inboxConversations.id }).from(inboxConversations)
            .where(eq(inboxConversations.id, scope.conversationId)).for("update");
        // 로그인 연결과 경합한 익명 증명도 쓰기 직전에 다시 확인한다.
        await visitorFileScope(key, token, tx, selection);
        const saved: StoredJourneyContext = { ...context, linkedAt: new Date().toISOString() };
        await tx.update(inboxConversations).set({ journeyContext: saved }).where(and(
            eq(inboxConversations.id, scope.conversationId), eq(inboxConversations.historyOnly, false),
            isNull(inboxConversations.mergedIntoId),
        ));
        return { linked: true };
    });
}

// 회원 JWT 발급 전에 서버가 확인한 externalId만 등록된 matchField와 대조한다.
// 이메일·전화·브라우저 식별값은 회원의 기존 리드 자동 연결 근거로 사용하지 않는다.
export async function connectVerifiedLead(orgId: string, workspaceId: number, contactId: string, exec: DbExec = db) {
    return exec.transaction(async tx => {
        const [contact] = await tx.select().from(crmContacts).where(and(
            eq(crmContacts.id, contactId), eq(crmContacts.orgId, orgId), eq(crmContacts.workspaceId, workspaceId),
        )).for("update");
        if (!contact || contact.recordId || contact.archivedAt) return contact;
        const [site] = await tx.select().from(trackerSites).where(and(
            eq(trackerSites.orgId, orgId), eq(trackerSites.workspaceId, workspaceId), eq(trackerSites.isActive, 1),
        ));
        if (!site?.matchField) return contact;
        const matches = await tx.select({ id: records.id }).from(records).where(and(
            eq(records.orgId, orgId), eq(records.workspaceId, workspaceId),
            sql`${records.data}->>${site.matchField} = ${contact.externalId}`,
        )).limit(2);
        if (matches.length !== 1) return contact;
        const [saved] = await tx.update(crmContacts).set({ recordId: matches[0].id,
            version: sql`${crmContacts.version}+1`, updatedAt: new Date(),
        }).where(eq(crmContacts.id, contact.id)).returning();
        await tx.update(inboxConversations).set({ recordId: saved.recordId,
            version: sql`${inboxConversations.version}+1`,
        }).where(and(eq(inboxConversations.contactId, contact.id), eq(inboxConversations.orgId, orgId),
            eq(inboxConversations.historyOnly, false), isNull(inboxConversations.recordId)));
        return saved;
    });
}

export async function conversationJourney(actor: Pick<JWTPayload, "orgId" | "userId" | "name" | "role">, id: string, exec: DbExec = db) {
    const chat = await ownedConversation(actor, id, exec);
    const [channel] = await exec.select().from(inboxChannels).where(eq(inboxChannels.id, chat.channelId));
    const [stored] = await exec.select({ context: inboxConversations.journeyContext }).from(inboxConversations).where(eq(inboxConversations.id, chat.id));
    const context = stored?.context;
    const [session] = context ? await exec.select().from(trackerSessions)
        .innerJoin(trackerSites, eq(trackerSites.id, trackerSessions.siteId))
        .where(and(eq(trackerSessions.id, context.sessionId), eq(trackerSessions.visitorId, context.visitorId),
            eq(trackerSites.id, context.siteId), eq(trackerSites.orgId, actor.orgId),
            eq(trackerSites.workspaceId, channel.workspaceId), eq(trackerSites.isActive, 1))) : [];
    const currentSession = session?.tracker_sessions;
    const [link] = currentSession?.clickId ? await exec.select({ recordId: records.id })
        .from(emailClickLogs).innerJoin(emailSendLogs, eq(emailSendLogs.id, emailClickLogs.sendLogId))
        .innerJoin(records, eq(records.id, emailSendLogs.recordId)).where(and(
            eq(emailClickLogs.clickId, currentSession.clickId), eq(emailClickLogs.isBot, false),
            eq(emailClickLogs.orgId, actor.orgId), eq(emailSendLogs.orgId, actor.orgId),
            eq(records.orgId, actor.orgId), eq(records.workspaceId, channel.workspaceId),
        )) : [];
    const browserLinks = !link && currentSession ? await exec.select({ recordId: records.id }).from(records)
        .innerJoin(visitorRecordLinks, eq(visitorRecordLinks.recordId, records.id)).where(and(
            eq(visitorRecordLinks.visitorId, currentSession.visitorId), eq(visitorRecordLinks.orgId, actor.orgId),
            eq(records.orgId, actor.orgId), eq(records.workspaceId, channel.workspaceId),
        )).limit(2) : [];
    const candidateId = link?.recordId ?? (browserLinks.length === 1 ? browserLinks[0].recordId : null);
    const [mappedContact] = chat.contactId ? await exec.select({ recordId: crmContacts.recordId }).from(crmContacts).where(and(
        eq(crmContacts.id, chat.contactId), eq(crmContacts.orgId, actor.orgId), eq(crmContacts.workspaceId, channel.workspaceId),
    )) : [];
    const verifiedRecordId = chat.recordId ?? mappedContact?.recordId ?? null;
    const recordId = verifiedRecordId ?? candidateId ?? null;
    const [record] = recordId ? await exec.select({ id: records.id, data: records.data }).from(records)
        .where(and(eq(records.id, recordId), eq(records.orgId, actor.orgId), eq(records.workspaceId, channel.workspaceId))) : [];
    const status = record ? (verifiedRecordId ? "confirmed" : "attributed") : currentSession ? "visitor" : "unlinked";
    const events: JourneyEvent[] = [];
    let sessionRows: (typeof trackerSessions.$inferSelect)[] = [];
    if (record) {
        const [emails, clicks, talks, business, direct, links] = await Promise.all([
            exec.select().from(emailSendLogs).where(and(eq(emailSendLogs.orgId, actor.orgId), eq(emailSendLogs.recordId, record.id))),
            exec.select({ click: emailClickLogs }).from(emailClickLogs).innerJoin(emailSendLogs, eq(emailSendLogs.id, emailClickLogs.sendLogId))
                .where(and(eq(emailSendLogs.orgId, actor.orgId), eq(emailSendLogs.recordId, record.id), eq(emailClickLogs.isBot, false))),
            exec.select().from(alimtalkSendLogs).where(and(eq(alimtalkSendLogs.orgId, actor.orgId), eq(alimtalkSendLogs.recordId, record.id))),
            exec.select().from(recordEvents).where(eq(recordEvents.recordId, record.id)),
            exec.select({ id: trackerVisitors.id }).from(trackerVisitors).innerJoin(trackerSites, eq(trackerSites.id, trackerVisitors.siteId))
                .where(and(eq(trackerVisitors.orgId, actor.orgId), eq(trackerVisitors.recordId, record.id), eq(trackerSites.workspaceId, channel.workspaceId))),
            exec.select({ id: visitorRecordLinks.visitorId }).from(visitorRecordLinks)
                .innerJoin(trackerVisitors, eq(trackerVisitors.id, visitorRecordLinks.visitorId))
                .innerJoin(trackerSites, eq(trackerSites.id, trackerVisitors.siteId))
                .where(and(eq(visitorRecordLinks.orgId, actor.orgId), eq(visitorRecordLinks.recordId, record.id), eq(trackerSites.workspaceId, channel.workspaceId))),
        ]);
        for (const row of emails) events.push({ at: row.sentAt.toISOString(), source: "email", channel: "메일", type: "email_sent", label: `메일 발송: ${row.subject || "제목 없음"}`, meta: { status: row.status } });
        for (const { click } of clicks) events.push({ at: click.clickedAt.toISOString(), source: "email", channel: "메일", type: "email_click", label: "메일 링크 클릭", meta: {} });
        for (const row of talks) events.push({ at: row.sentAt.toISOString(), source: "business", channel: "알림톡", type: "alimtalk_sent", label: "알림톡 발송", meta: { status: row.status } });
        for (const row of business) events.push({ at: row.occurredAt.toISOString(), source: "business", channel: "고객", type: row.type, label: row.label, meta: {} });
        const mappedContacts = await exec.select({ id: crmContacts.id }).from(crmContacts).where(and(
            eq(crmContacts.orgId, actor.orgId), eq(crmContacts.workspaceId, channel.workspaceId), eq(crmContacts.recordId, record.id),
        ));
        events.push(...await loadInboxJourney(actor.orgId, [record.id], exec, mappedContacts.map(row => row.id)));
        const visitorIds = [...new Set([...direct, ...links].map(row => row.id))];
        if (visitorIds.length) sessionRows = await exec.select().from(trackerSessions)
            .where(inArray(trackerSessions.visitorId, visitorIds));
    }
    if (currentSession && !sessionRows.some(row => row.id === currentSession.id)) sessionRows.push(currentSession);
    if (sessionRows.length) {
        const pages = await exec.select().from(trackerEvents).where(inArray(trackerEvents.sessionId, sessionRows.map(row => row.id))).orderBy(asc(trackerEvents.occurredAt));
        const cleanUrl = (value: string | null) => { try { const url = new URL(value || ""); return url.origin + url.pathname; } catch { return null; } };
        events.push(...normalizeTrackerEvents(sessionRows.map(row => ({ ...row, landingPage: cleanUrl(row.landingPage), referrer: cleanUrl(row.referrer) })),
            pages.map(row => ({ ...row, pageUrl: cleanUrl(row.pageUrl), properties: null })), buildTrackerLabelMaps([], [])));
    }
    if (!verifiedRecordId) {
        // 유입 후보는 기존 고객을 변경하지 않는다. 현재 상담은 별도로 합쳐 보여준다.
        const { inboxMessages } = await import("@/lib/db");
        const messages = await exec.select().from(inboxMessages).where(and(eq(inboxMessages.conversationId, chat.id), sql`${inboxMessages.kind} <> 'note'`));
        for (const m of messages) events.push({ at: m.createdAt.toISOString(), source: "inbox", channel: "상담", type: `chat_${m.kind}`, label: `${m.kind === "customer" ? "고객 문의" : "상담 답변"}: ${m.body.slice(0, 80)}`, meta: {} });
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
    return { status, record: record ? { id: record.id, name: String(record.data?.name || record.data?.company || `리드 #${record.id}`) } : null,
        evidence: verifiedRecordId ? "member_or_staff" : link ? "email_link" : candidateId ? "visitor_link" : null,
        ambiguous: !link && browserLinks.length > 1,
        conflict: !!(verifiedRecordId && candidateId && verifiedRecordId !== candidateId),
        events, total: events.length, linkedAt: context?.linkedAt ?? null };
}
