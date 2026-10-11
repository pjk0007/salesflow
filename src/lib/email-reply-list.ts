/**
 * 회신 탭·레코드·규칙 화면이 읽는 회신 목록 (DESIGN-RPL 10-3·11절). 읽기와 권한 거르기만 한다.
 *
 * 권한: 사용자가 볼 수 있는 파티션(loadOrgScopes + filterAccessiblePartitions)의 발송에 이어진 회신만.
 * 미분류(unmatched)·애매함(ambiguous)은 관리자만 (멤버는 이어진 발송이 없어 파티션으로 거를 수 없다).
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
    db,
    emailAutoPersonalizedLinks,
    emailReplies,
    emailSendLogs,
    emailTemplateLinks,
    partitions,
    records,
    workspaces,
} from "@/lib/db";
import { filterAccessiblePartitions, loadOrgScopes } from "@/lib/partition-access";
import { EMAIL_TRIM_CHARS, MATCH_WINDOW_DAYS, REPLY_KINDS, addressVariants, resolveReplyConfig } from "@/lib/email-reply-rules";
import type { JWTPayload } from "@/types";

type RequestUser = Pick<JWTPayload, "userId" | "orgId" | "role">;

/**
 * 회신 읽기 대상 조직 = REPLY_WORKSPACE_IDS(없으면 DEEP_ALERT_WORKSPACE_IDS) 워크스페이스의 조직.
 * 샌드비는 여러 조직이 쓴다 — 회신 메일함은 매치스플랜 대표 메일함 하나라 다른 조직에는 회신 탭·연결 상태를 보이지 않는다 (RH-SEC-5)
 */
export async function replyScopeOrgIds(env: Record<string, string | undefined> = process.env): Promise<string[]> {
    const ids = resolveReplyConfig(env).workspaceIds;
    if (ids.length === 0) return [];
    const rows = (await db.execute(
        sql`SELECT DISTINCT org_id FROM workspaces WHERE id = ANY(${sql.param(ids)}::int[])`
    )) as unknown as Array<{ org_id: string }>;
    return rows.map((r) => r.org_id);
}

export async function isReplyScopeOrg(orgId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
    return (await replyScopeOrgIds(env)).includes(orgId);
}

export interface ReplyListFilters {
    page: number;
    pageSize: number;
    kind?: string;
    matchStatus?: string;
    workspaceId?: number;
    recordId?: number;
    sendLogId?: number;
    /** true = 처리함, false = 안 함 */
    handled?: boolean;
    id?: number;
}

export interface ReplySendLogView {
    id: number;
    subject: string | null;
    sentAt: Date;
    senderEmail: string | null;
    recipientEmail: string;
    partitionId: number | null;
    partitionName: string | null;
}

/** 화면에 내려주는 회신 한 줄 */
export interface ReplyView {
    id: number;
    receivedAt: Date;
    workspaceId: number | null;
    workspaceName: string | null;
    workspaceGuessed: boolean;
    recordId: number | null;
    integratedCode: string | null;
    sendLogId: number | null;
    fromEmail: string;
    fromName: string | null;
    toEmail: string;
    contactEmail: string;
    matchedRecipient: string | null;
    subject: string | null;
    excerpt: string | null;
    kind: string;
    bounceType: string | null;
    dsnStatus: string | null;
    dsnDiagnostic: string | null;
    unsubscribeHint: boolean;
    oursReason: string;
    matchStatus: string;
    matchMethod: string | null;
    ruleKind: string | null;
    ruleId: number | null;
    ruleName: string | null;
    stepIndex: number | null;
    detectedMode: string;
    processError: string | null;
    effectsAppliedAt: Date | null;
    effectsAppliedKind: string | null;
    effects: Record<string, unknown> | null;
    stopAutomation: boolean;
    alertStatus: string | null;
    alertMessage: string | null;
    alertLastError: string | null;
    alertSentAt: Date | null;
    handledAt: Date | null;
    handledBy: string | null;
    kindChangedAt: Date | null;
    sendLog: ReplySendLogView | null;
}

export interface AmbiguousCandidate {
    sendLogId: number;
    workspaceId: number | null;
    workspaceName: string | null;
    partitionName: string | null;
    subject: string | null;
    sentAt: Date;
    senderEmail: string | null;
    ruleName: string | null;
}

export function isAdminRole(role: string): boolean {
    return role !== "member";
}

/** 멤버가 볼 수 있는 파티션 id (관리자는 null = 전부) */
async function visiblePartitionIds(user: RequestUser): Promise<number[] | null> {
    if (isAdminRole(user.role)) return null;
    const parts = await db
        .select({ id: partitions.id, folderId: partitions.folderId, workspaceId: partitions.workspaceId })
        .from(partitions)
        .innerJoin(workspaces, eq(partitions.workspaceId, workspaces.id))
        .where(eq(workspaces.orgId, user.orgId));
    const orgScopes = await loadOrgScopes(user.orgId);
    return filterAccessiblePartitions({ user, partitions: parts, permission: "read", orgScopes }).map((p) => p.id);
}

async function accessCondition(user: RequestUser): Promise<SQL | null> {
    const ids = await visiblePartitionIds(user);
    if (ids === null) return null;
    if (ids.length === 0) return sql`false`;
    return and(eq(emailReplies.matchStatus, "matched"), inArray(emailSendLogs.partitionId, ids)) ?? sql`false`;
}

function selectReplies() {
    return db
        .select({
            reply: emailReplies,
            workspaceName: workspaces.name,
            integratedCode: records.integratedCode,
            logId: emailSendLogs.id,
            logSubject: emailSendLogs.subject,
            logSentAt: emailSendLogs.sentAt,
            logSenderEmail: emailSendLogs.senderEmail,
            logRecipientEmail: emailSendLogs.recipientEmail,
            logPartitionId: emailSendLogs.partitionId,
            partitionName: partitions.name,
            aiRuleName: emailAutoPersonalizedLinks.name,
            templateRuleName: emailTemplateLinks.name,
        })
        .from(emailReplies)
        .leftJoin(workspaces, and(eq(workspaces.id, emailReplies.workspaceId), eq(workspaces.orgId, emailReplies.orgId)))
        .leftJoin(records, eq(records.id, emailReplies.recordId))
        .leftJoin(emailSendLogs, and(eq(emailSendLogs.id, emailReplies.sendLogId), eq(emailSendLogs.orgId, emailReplies.orgId)))
        .leftJoin(partitions, eq(partitions.id, emailSendLogs.partitionId))
        .leftJoin(
            emailAutoPersonalizedLinks,
            and(
                eq(emailReplies.ruleKind, "ai"),
                eq(emailAutoPersonalizedLinks.id, emailReplies.ruleId),
                eq(emailAutoPersonalizedLinks.orgId, emailReplies.orgId)
            )
        )
        .leftJoin(emailTemplateLinks, and(eq(emailReplies.ruleKind, "template"), eq(emailTemplateLinks.id, emailReplies.ruleId)));
}

type SelectedRow = Awaited<ReturnType<ReturnType<typeof selectReplies>["where"]>>[number];

function toView(r: SelectedRow): ReplyView {
    const e = r.reply;
    return {
        id: e.id,
        receivedAt: e.receivedAt,
        workspaceId: e.workspaceId,
        workspaceName: r.workspaceName,
        workspaceGuessed: e.workspaceGuessed,
        recordId: e.recordId,
        integratedCode: r.integratedCode,
        sendLogId: e.sendLogId,
        fromEmail: e.fromEmail,
        fromName: e.fromName,
        toEmail: e.toEmail,
        contactEmail: e.contactEmail,
        matchedRecipient: e.matchedRecipient,
        subject: e.subject,
        excerpt: e.excerpt,
        kind: e.kind,
        bounceType: e.bounceType,
        dsnStatus: e.dsnStatus,
        dsnDiagnostic: e.dsnDiagnostic,
        unsubscribeHint: e.unsubscribeHint,
        oursReason: e.oursReason,
        matchStatus: e.matchStatus,
        matchMethod: e.matchMethod,
        ruleKind: e.ruleKind,
        ruleId: e.ruleId,
        ruleName: e.ruleKind === "ai" ? r.aiRuleName : e.ruleKind === "template" ? r.templateRuleName : null,
        stepIndex: e.stepIndex,
        detectedMode: e.detectedMode,
        processError: e.processError,
        effectsAppliedAt: e.effectsAppliedAt,
        effectsAppliedKind: e.effectsAppliedKind,
        effects: e.effects ?? null,
        stopAutomation: e.stopAutomation,
        alertStatus: e.alertStatus,
        alertMessage: e.alertMessage,
        alertLastError: e.alertLastError,
        alertSentAt: e.alertSentAt,
        handledAt: e.handledAt,
        handledBy: e.handledBy,
        kindChangedAt: e.kindChangedAt,
        sendLog:
            r.logId !== null && r.logSentAt !== null && r.logRecipientEmail !== null
                ? {
                      id: r.logId,
                      subject: r.logSubject,
                      sentAt: r.logSentAt,
                      senderEmail: r.logSenderEmail,
                      recipientEmail: r.logRecipientEmail,
                      partitionId: r.logPartitionId,
                      partitionName: r.partitionName,
                  }
                : null,
    };
}

/** 목록 (쪽). 관리자가 아니면 볼 수 있는 파티션의 이어진 회신만 */
export async function listReplies(user: RequestUser, f: ReplyListFilters): Promise<{ items: ReplyView[]; totalCount: number }> {
    const conditions: SQL[] = [eq(emailReplies.orgId, user.orgId)];
    const access = await accessCondition(user);
    if (access) conditions.push(access);
    if (f.id) conditions.push(eq(emailReplies.id, f.id));
    if (f.kind && (REPLY_KINDS as readonly string[]).includes(f.kind)) conditions.push(eq(emailReplies.kind, f.kind));
    if (f.matchStatus) {
        // 모르는 값은 빈 목록 (멤버가 미분류·애매함으로 거른 경우 포함)
        conditions.push(["matched", "unmatched", "ambiguous"].includes(f.matchStatus) ? eq(emailReplies.matchStatus, f.matchStatus) : sql`false`);
    }
    if (f.workspaceId) conditions.push(eq(emailReplies.workspaceId, f.workspaceId));
    if (f.recordId) conditions.push(eq(emailReplies.recordId, f.recordId));
    if (f.sendLogId) conditions.push(eq(emailReplies.sendLogId, f.sendLogId));
    if (f.handled === true) conditions.push(isNotNull(emailReplies.handledAt));
    if (f.handled === false) conditions.push(isNull(emailReplies.handledAt));
    const where = and(...conditions);

    const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(emailReplies)
        .leftJoin(emailSendLogs, and(eq(emailSendLogs.id, emailReplies.sendLogId), eq(emailSendLogs.orgId, emailReplies.orgId)))
        .where(where);
    const rows = await selectReplies()
        .where(where)
        .orderBy(desc(emailReplies.receivedAt), desc(emailReplies.id))
        .limit(f.pageSize)
        .offset((f.page - 1) * f.pageSize);
    return { items: rows.map(toView), totalCount: Number(countRow?.count ?? 0) };
}

/** 회신 하나 (같은 권한). 없거나 볼 수 없으면 null */
export async function getReplyForUser(user: RequestUser, id: number): Promise<ReplyView | null> {
    const { items } = await listReplies(user, { page: 1, pageSize: 1, id });
    return items[0] ?? null;
}

/**
 * 애매함 줄의 후보 발송 (관리자 옆 창, 6-3): 같은 조직에서 그 주소로 도착 전 60일 안 보낸 발송.
 * 회신을 손으로 발송에 잇는 버튼은 다음 판 — 지금은 보기만 한다
 */
export async function ambiguousCandidates(orgId: string, reply: ReplyView): Promise<AmbiguousCandidate[]> {
    const since = new Date(reply.receivedAt.getTime() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const emails = addressVariants(reply.contactEmail);
    if (emails.length === 0) return [];
    const rows = await db
        .select({
            id: emailSendLogs.id,
            workspaceId: partitions.workspaceId,
            workspaceName: workspaces.name,
            partitionName: partitions.name,
            subject: emailSendLogs.subject,
            sentAt: emailSendLogs.sentAt,
            senderEmail: emailSendLogs.senderEmail,
            aiRuleName: emailAutoPersonalizedLinks.name,
            templateRuleName: emailTemplateLinks.name,
        })
        .from(emailSendLogs)
        .leftJoin(partitions, eq(partitions.id, emailSendLogs.partitionId))
        .leftJoin(workspaces, eq(workspaces.id, partitions.workspaceId))
        .leftJoin(emailAutoPersonalizedLinks, eq(emailAutoPersonalizedLinks.id, emailSendLogs.autoPersonalizedLinkId))
        .leftJoin(emailTemplateLinks, eq(emailTemplateLinks.id, emailSendLogs.templateLinkId))
        .where(
            and(
                eq(emailSendLogs.orgId, orgId),
                gte(emailSendLogs.sentAt, since),
                sql`${emailSendLogs.sentAt} <= ${reply.receivedAt.toISOString()}::timestamptz`,
                sql`lower(btrim(${emailSendLogs.recipientEmail}, ${EMAIL_TRIM_CHARS}::text)) = ANY(${sql.param(emails)}::text[])`
            )
        )
        .orderBy(desc(emailSendLogs.sentAt))
        .limit(20);
    return rows.map((r) => ({
        sendLogId: r.id,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
        partitionName: r.partitionName,
        subject: r.subject,
        sentAt: r.sentAt,
        senderEmail: r.senderEmail,
        ruleName: r.aiRuleName ?? r.templateRuleName ?? null,
    }));
}

/** 규칙별 회신 수 (규칙 목록 배지, 10-3). 키 "ai:12"·"template:5" */
export async function replyStatsByRule(
    orgId: string,
    days: number
): Promise<{ byRule: Record<string, { human: number; auto_reply: number; bounce: number }>; total: number }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
        .select({
            ruleKind: emailReplies.ruleKind,
            ruleId: emailReplies.ruleId,
            kind: emailReplies.kind,
            n: sql<number>`count(*)::int`,
        })
        .from(emailReplies)
        .where(
            and(
                eq(emailReplies.orgId, orgId),
                gte(emailReplies.receivedAt, since),
                eq(emailReplies.matchStatus, "matched"),
                inArray(emailReplies.kind, ["human", "auto_reply", "bounce"])
            )
        )
        .groupBy(emailReplies.ruleKind, emailReplies.ruleId, emailReplies.kind);
    const byRule: Record<string, { human: number; auto_reply: number; bounce: number }> = {};
    let total = 0;
    for (const r of rows) {
        if (!r.ruleKind || r.ruleId === null || r.ruleKind === "manual") continue;
        const key = `${r.ruleKind}:${r.ruleId}`;
        const entry = (byRule[key] ??= { human: 0, auto_reply: 0, bounce: 0 });
        const n = Number(r.n);
        if (r.kind === "human" || r.kind === "auto_reply" || r.kind === "bounce") entry[r.kind] += n;
        if (r.kind === "human") total += n;
    }
    return { byRule, total };
}

/** 발송 기록마다 붙일 회신 (발송 이력 배지, 10-3): 사람 회신 먼저, 그다음 반송·자동응답, 같은 분류면 가장 최근 */
export async function repliesForSendLogs(
    orgId: string,
    logIds: number[]
): Promise<Map<number, { id: number; kind: string; receivedAt: Date }>> {
    const out = new Map<number, { id: number; kind: string; receivedAt: Date }>();
    if (logIds.length === 0) return out;
    const rows = await db
        .select({ id: emailReplies.id, sendLogId: emailReplies.sendLogId, kind: emailReplies.kind, receivedAt: emailReplies.receivedAt })
        .from(emailReplies)
        .where(
            and(
                eq(emailReplies.orgId, orgId),
                inArray(emailReplies.sendLogId, logIds),
                inArray(emailReplies.kind, ["human", "bounce", "auto_reply"])
            )
        );
    const rank = (k: string) => (k === "human" ? 0 : k === "bounce" ? 1 : 2);
    for (const r of rows) {
        if (r.sendLogId === null) continue;
        const prev = out.get(r.sendLogId);
        if (
            !prev ||
            rank(r.kind) < rank(prev.kind) ||
            (rank(r.kind) === rank(prev.kind) && r.receivedAt.getTime() > prev.receivedAt.getTime())
        ) {
            out.set(r.sendLogId, { id: r.id, kind: r.kind, receivedAt: r.receivedAt });
        }
    }
    return out;
}
