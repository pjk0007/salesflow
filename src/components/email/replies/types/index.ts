/**
 * 회신 탭·배지 타입 (DESIGN-RPL 11절). 서버 응답(JSON)이라 시각은 문자열이다.
 * GET /api/email/replies, PATCH /api/email/replies/[id], GET /api/email/replies/stats
 */

export type ReplyKind = "human" | "auto_reply" | "bounce" | "system" | "internal" | "unknown";
export type ReplyMatchStatus = "matched" | "unmatched" | "ambiguous";

export interface ReplySendLog {
    id: number;
    subject: string | null;
    sentAt: string;
    senderEmail: string | null;
    recipientEmail: string;
    partitionId: number | null;
    partitionName: string | null;
}

export interface ReplyItem {
    id: number;
    receivedAt: string;
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
    kind: ReplyKind | string;
    bounceType: string | null;
    dsnStatus: string | null;
    dsnDiagnostic: string | null;
    unsubscribeHint: boolean;
    oursReason: string;
    matchStatus: ReplyMatchStatus | string;
    matchMethod: string | null;
    ruleKind: string | null;
    ruleId: number | null;
    ruleName: string | null;
    stepIndex: number | null;
    detectedMode: string;
    processError: string | null;
    effectsAppliedAt: string | null;
    effectsAppliedKind: string | null;
    effects: Record<string, unknown> | null;
    stopAutomation: boolean;
    alertStatus: string | null;
    alertMessage: string | null;
    alertLastError: string | null;
    alertSentAt: string | null;
    handledAt: string | null;
    handledBy: string | null;
    kindChangedAt: string | null;
    sendLog: ReplySendLog | null;
}

/** 회신 탭 위 띠 (meta.sync) */
export interface ReplySyncStatus {
    mode: "off" | "dry_run" | "on";
    requestedMode: "off" | "dry_run" | "on";
    alertMode: "off" | "dry_run" | "live";
    serverKind: "production" | "test";
    configured: boolean;
    mailboxMasked: string;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    errorCode: string | null;
    errorText: string | null;
    errorSince: string | null;
    backfillDone: boolean;
    excluded: string[];
    warnings: string[];
    tableMissing?: boolean;
}

export interface AmbiguousCandidate {
    sendLogId: number;
    workspaceId: number | null;
    workspaceName: string | null;
    partitionName: string | null;
    subject: string | null;
    sentAt: string;
    senderEmail: string | null;
    ruleName: string | null;
}

export interface RepliesResponse {
    success: boolean;
    data?: ReplyItem[];
    totalCount?: number;
    /** enabled=false면 회신 읽기 대상 조직이 아니다 — sync는 null (대표 메일함 상태를 내려주지 않는다) */
    meta?: { enabled?: boolean; sync: ReplySyncStatus | null; isAdmin: boolean; candidates?: AmbiguousCandidate[] };
    error?: string;
}

export interface ReplyFilters {
    page?: number;
    kind?: string;
    matchStatus?: string;
    handled?: "0" | "1";
    workspaceId?: number;
    recordId?: number;
    id?: number;
    pageSize?: number;
}

export interface ReplyPatch {
    handled?: boolean;
    kind?: ReplyKind;
    stopAutomation?: boolean;
}

export interface RuleReplyCounts {
    human: number;
    auto_reply: number;
    bounce: number;
}

export interface ReplyStatsResponse {
    success: boolean;
    data?: { byRule: Record<string, RuleReplyCounts>; total: number; days: number };
}

/** GET /api/email/replies/status — 이 조직에 회신 탭을 보일지 */
export interface RepliesStatusResponse {
    success: boolean;
    data?: { enabled: boolean };
    error?: string;
}
