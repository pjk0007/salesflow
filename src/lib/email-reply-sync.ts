import { acquireWorkerLock } from "./db/worker-lock";
/**
 * 회신 받기 워커 — 5분마다 회신 메일함(Gmail)에서 샌드비 발신 주소 앞으로 온 메일만 읽어 발송 기록에 잇고,
 * 사람 회신이면 그 사업의 자동 메일을 멈추고 알린다. 반송 안내는 SND 신호로 넘긴다.
 *
 * 흐름 (DESIGN-RPL 1절·10-1):
 *   설정 → 잠금(0x5c4edf07) → 상태 줄 → 토큰·메일함 주인 확인 → 우리 발신 주소 모음(B1) → (on) 밀린 효과
 *   → 새 메일 번호(history 이어 읽기 / 404면 목록으로 거슬러 읽기) → 묶음마다
 *        1단계 받는 사람·스레드 머리글 → 판정 → (시험 서버) 1.5단계 From → 2단계 본문 → 분류 → 짝짓기 → 저장·효과(메일마다 한 트랜잭션)
 *   → 처음 거슬러 읽기 → 알림 보내기 → 상태 저장(운영 알림)
 *
 * 개인정보: 남의 메일은 1단계(받는 사람·스레드 머리글)만 읽고 건수만 센다 — 번호·해시도 남기지 않는다.
 * 로그에는 회차 숫자만 남긴다 (주소·제목·발췌·오류 객체를 찍지 않는다).
 * 설계: docs/2026-10-11-reply-and-health/DESIGN-RPL.md
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DbExec, DbTx } from "@/lib/db/tx";
import {
    GmailApiError,
    createGmailClient,
    type GmailClient,
    type GmailMessage,
} from "@/lib/gmail-client";
import {
    chatRequestIdEnabled,
    chatRequestIdFor,
    chatThreadsEnabled,
    chatWebhookProblem,
    postGoogleChatText,
    type GoogleChatResult,
} from "@/lib/google-chat";
import {
    chatWebhookBroken,
    webhookFingerprint,
    clearChatWebhookConfigProblem,
    notifyWebhookProblems,
    recordChatWebhookConfig,
    recordChatWebhookResult,
} from "@/lib/chat-webhook-status";
import { deliverClaimedBatch, type ClaimedAlert, type DeliveryDeps } from "@/lib/deep-visitor-alert-delivery";
import { MAX_ATTEMPTS, STALE_AFTER_MS } from "@/lib/deep-visitor-alert-rules";
import {
    ALERT_DELIVERY_BUDGET_MS,
    ALERT_STUCK_MS,
    BODY_MAX_PER_RUN,
    CHAIN_MAX_DEPTH,
    EMAIL_TRIM_CHARS,
    EXCERPT_MAX_CHARS,
    FULL_FORMAT_MAX_BYTES,
    GMAIL_CONCURRENCY,
    MATCH_WINDOW_DAYS,
    PENDING_EFFECTS_BATCH,
    PENDING_EFFECTS_DAYS,
    OPS_ALERT_INTERVAL_MS,
    PROCESS_BATCH_SIZE,
    READ_BUDGET_MS,
    RUN_BUDGET_MS,
    SENDER_LOG_LOOKBACK_DAYS,
    STAGE1_MAX_PER_RUN,
    STALE_SYNC_MS,
    addressVariants,
    backfillListQuery,
    bounceTypeOf,
    buildOpsAlertMessage,
    buildOpsRecoveredMessage,
    refreshReplyCardForSend,
    replyServerLabel,
    buildOurAddressSet,
    classifyReply,
    countKind,
    decodeMimeWords,
    describeReplyError,
    emptyRunCounts,
    extractBodies,
    fallbackListAfter,
    feedbackRecipientOf,
    hasUnsubscribeHint,
    headerValue,
    headerValues,
    isConnectionError,
    isSkippedLabel,
    isSpamLabel,
    makeExcerpt,
    maskEmail,
    mergeDailyCounts,
    nextBackfillBefore,
    normalizeReplyAddress,
    originalMessageIdOf,
    parseAddressList,
    parseDeliveryStatus,
    parseMessageIds,
    pgErrorOf,
    pickFallbackLog,
    pickThreadLog,
    processErrorText,
    recipientOwnership,
    replyAlertStatus,
    replyAlertTarget,
    replyErrorText,
    replyTextOf,
    reportPartsToFetch,
    requestIdCandidatesOf,
    resolveReplyConfig,
    ruleOf,
    runSummaryLine,
    shouldSendOpsAlert,
    threadRequestIdCandidates,
    type AddressCandidate,
    type Classification,
    type DsnRecipient,
    type FallbackLogCandidate,
    type OurAddressSet,
    type ReplyAlertMode,
    type ReplyConfig,
    type ReplyErrorCode,
    type ReplyKind,
    type ReplyRunCounts,
    type ReplyServerKind,
    type ReplySyncMode,
} from "@/lib/email-reply-rules";
import {
    applyPendingBouncesForReplies,
    buildAlertMessageFor,
    claimReplyEffects,
    recordBounceForReply,
    stopAutomationForReply,
    type CardReply,
    type HumanReplyEffectsInput,
} from "@/lib/email-reply-effects";

/** 정기 작업 잠금 키 — 01~06(예약등록·발송 큐·깊이 알림·후속·반복)과 SND 08·09·0a와 다르다 */
export const REPLY_LOCK_KEY = 0x5c4edf07;

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_BATCH = 20;
const STUCK_ALERT_ERROR = "처리 중 멈춤 — 되돌림";
const STALE_ALERT_ERROR = "오래되어 보내지 않음 (예약 시각 24시간 지남)";

type Env = Record<string, string | undefined>;

export interface ReplyAlertTally {
    sent: number;
    failed: number;
    requeued: number;
    skipped: number;
    deferred: number;
    expired: number;
    reclaimed: number;
}

/** 회차 결과 — 숫자와 모드만 (주소·제목 없음) */
export interface ReplySyncStats {
    mode: ReplySyncMode;
    alertMode: ReplyAlertMode;
    serverKind: ReplyServerKind;
    configured?: false;
    noWorkspaces?: true;
    /** 설정 때문에 메일함을 읽지 않음 (ReplyConfig.readBlockedReason) */
    readBlocked?: "private_domains_missing";
    skippedAsLocked?: true;
    tableMissing?: true;
    error?: ReplyErrorCode;
    counts: ReplyRunCounts;
    alerts: ReplyAlertTally;
    gmailCalls: number;
    backfill: { active: boolean; done: boolean };
    budgetHit?: boolean;
    warnings: string[];
}

// ============================================
// 공개 진입점
// ============================================

/**
 * 한 회차. 잠금을 못 잡으면 Gmail을 부르지 않는다 (R36). off면 아무것도 하지 않고(R1), 비밀값이 없으면 Google을 부르지 않는다(R2).
 * Gmail 인증·권한·메일함 다름은 200으로 돌려준다 (스케줄러가 재시도 폭주하지 않게) — 운영 알림·회신 탭 띠로 알린다.
 * DB 연결·자원 오류만 던진다 (라우트가 500).
 */
export async function processReplySync(opts: { now?: Date; env?: Env; fetchImpl?: typeof fetch } = {}): Promise<ReplySyncStats> {
    const env = opts.env ?? process.env;
    const config = resolveReplyConfig(env);
    const now = opts.now ?? new Date();
    const stats: ReplySyncStats = {
        mode: config.syncMode,
        alertMode: config.alertMode,
        serverKind: config.serverKind,
        counts: emptyRunCounts(),
        alerts: { sent: 0, failed: 0, requeued: 0, skipped: 0, deferred: 0, expired: 0, reclaimed: 0 },
        gmailCalls: 0,
        backfill: { active: false, done: false },
        warnings: config.warnings.map((w) => w.code),
    };

    if (config.syncMode === "off") return stats;
    if (config.readBlockedReason) {
        // 운영 서버인데 메일함 쪽 도메인 설정이 비었다 — 메일함을 읽지 않는다 (RH-SEC-2). 회신 탭 띠에 경고가 보이고,
        // 운영 스페이스에도 6시간에 한 번 알린다 (RO-13)
        console.warn(`[reply-sync] 메일함을 읽지 않음 (${config.readBlockedReason}) — REPLY_PRIVATE_DOMAINS 확인 필요`);
        await recordReadBlocked(config, env).catch((e: unknown) => {
            console.warn(`[reply-sync] 읽기 막힘 기록 실패: ${describeReplyError(e)}`);
        });
        return { ...stats, readBlocked: config.readBlockedReason };
    }
    if (!config.credentials) {
        console.log("[reply-sync] 메일함 비밀값 없음(REPLY_GOOGLE_*) — 건너뜀");
        return { ...stats, configured: false };
    }
    // 여러 조직이 쓰는 서비스다 — 허용 워크스페이스가 없으면 어느 조직 메일도 잇지 않는다
    if (config.workspaceIds.length === 0) {
        console.log("[reply-sync] 허용 워크스페이스 없음 — 건너뜀");
        return { ...stats, noWorkspaces: true };
    }

    const workerLock = await acquireWorkerLock(REPLY_LOCK_KEY);
    try {
        if (!workerLock) {
            console.log("[reply-sync] 다른 회차가 도는 중 — 건너뜀");
            return { ...stats, skippedAsLocked: true };
        }
        const run = new ReplyRun(config, env, now, stats, opts.fetchImpl ?? fetch);
        return await run.execute();
    } catch (e) {
        if (isReplyTableMissing(e)) {
            console.warn("[reply-sync] email_replies 표가 없음 (마이그레이션 0074 확인 필요)");
            return { ...stats, tableMissing: true };
        }
        throw e;
    } finally {
        await workerLock?.release();
    }
}

/** 42P01 = 표 없음. 회신 표 이름일 때만 (다른 표가 없을 때까지 삼키지 않게) */
function isReplyTableMissing(e: unknown): boolean {
    const pg = pgErrorOf(e);
    return pg !== null && pg.code === "42P01" && /email_repl(ies|y_mailbox_state)/.test(pg.message);
}

// ============================================
// 내부 타입
// ============================================

interface StateRow {
    mailbox: string;
    history_id: string | null;
    backfill_after: string | Date | null;
    backfill_before: string | Date | null;
    backfill_done_at: string | Date | null;
    last_success_at: string | Date | null;
    last_error_code: string | null;
    last_error_at: string | Date | null;
    ops_alerted_at: string | Date | null;
    ops_alerted_code: string | null;
    ops_recovery_code: string | null;
    ops_recovered_at: string | Date | null;
    stats: Record<string, unknown> | null;
}

/** 새 메일 하나 (history 기록 번호가 있으면 그 순서로 커서를 옮긴다) */
interface Entry {
    historyId: string | null;
    id: string;
    labelIds: string[] | null;
}

interface LogRow {
    id: number;
    org_id: string;
    record_id: number | null;
    partition_id: number | null;
    workspace_id: number | null;
    recipient_email: string;
    sender_email: string | null;
    profile_from_email: string | null;
    subject: string | null;
    sent_at: string | Date;
    request_id: string | null;
    template_link_id: number | null;
    auto_personalized_link_id: number | null;
    parent_log_id: number | null;
}

type LogCandidate = FallbackLogCandidate & { row: LogRow; requestId: string | null };

interface ChainInfo {
    rootId: number;
    depth: number;
    ruleKind: "ai" | "template" | "manual";
    ruleId: number | null;
}

/** 2단계까지 읽고 분류한 우리 메일 */
interface ParsedMessage {
    entry: Entry;
    gmailId: string;
    threadId: string | null;
    labelIds: string[];
    receivedAt: Date;
    ownership: { reason: "address" | "domain_thread"; address: string; orgIds: string[] };
    fromEmail: string;
    fromName: string | null;
    subject: string | null;
    rfcMessageId: string | null;
    classification: Classification;
    excerpt: string | null;
    unsubscribeHint: boolean;
    threadCandidates: string[];
    dsnRecipients: DsnRecipient[];
    feedbackRecipient: string | null;
    /** 해석 오류 (메일 하나) */
    parseError: string | null;
}

interface MatchDecision {
    status: "matched" | "unmatched" | "ambiguous";
    method: string | null;
    log: LogRow | null;
    orgId: string | null;
    workspaceId: number | null;
    workspaceGuessed: boolean;
}

function toDate(v: string | Date | null | undefined): Date | null {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
}

function clip(value: string | null | undefined, max: number): string | null {
    if (value === null || value === undefined) return null;
    const chars = Array.from(value);
    return chars.length > max ? chars.slice(0, max).join("") : value;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const out = new Array<R>(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

function rows<T>(result: unknown): T[] {
    return result as T[];
}

const LOG_COLUMNS = sql.raw(`
    l.id, l.org_id, r.id AS record_id, l.partition_id, p.workspace_id, l.recipient_email, l.sender_email,
    sp.from_email AS profile_from_email, l.subject, l.sent_at, l.request_id, l.template_link_id,
    l.auto_personalized_link_id, l.parent_log_id
`);
const LOG_JOINS = sql.raw(`
    LEFT JOIN records r ON r.id = l.record_id AND r.org_id = l.org_id
    LEFT JOIN partitions p ON p.id = l.partition_id
    LEFT JOIN email_sender_profiles sp ON sp.id = l.sender_profile_id AND sp.org_id = l.org_id
`);

// ============================================
// 회차
// ============================================

class ReplyRun {
    private readonly startedAt = Date.now();
    private readonly gmail: GmailClient;
    private state!: StateRow;
    private ourSet!: OurAddressSet;
    private orgIds: string[] = [];
    private orgUsers = new Map<string, Set<string>>();
    private stage1Left = STAGE1_MAX_PER_RUN;
    private bodyLeft = BODY_MAX_PER_RUN;
    private readonly seen = new Set<string>();
    private profileEmail = "";

    constructor(
        private readonly config: ReplyConfig,
        private readonly env: Env,
        private readonly now: Date,
        private readonly stats: ReplySyncStats,
        fetchImpl: typeof fetch
    ) {
        this.gmail = createGmailClient(config.credentials!, fetchImpl);
    }

    private get counts(): ReplyRunCounts {
        return this.stats.counts;
    }

    /** 메일 읽기 예산 — 알림 보내기 몫(60초)을 늘 남긴다 (RC-14) */
    private overBudget(): boolean {
        return Date.now() - this.startedAt > READ_BUDGET_MS;
    }

    private alertsLive(): boolean {
        return this.config.syncMode === "on" && this.config.alertMode === "live";
    }

    /** Gmail이 끊겨도 이미 만든 카드는 보낸다 (RC-1). DB가 끊긴 경우가 아니면 실패해도 회차를 막지 않는다 */
    private async deliverAlertsSafely(): Promise<void> {
        if (!this.alertsLive()) return;
        try {
            await this.deliverAlerts();
        } catch (e) {
            console.error(`[reply-sync] 알림 보내기 실패: ${describeReplyError(e)}`);
        }
    }

    async execute(): Promise<ReplySyncStats> {
        this.state = await this.loadState();
        this.stats.alerts.reclaimed = await this.reclaimStuckAlerts();
        if (this.alertsLive()) await this.recordWebhookConfig();

        try {
            const profile = await this.gmail.getProfile();
            this.profileEmail = profile.emailAddress;
            if (normalizeReplyAddress(profile.emailAddress) !== normalizeReplyAddress(this.config.mailbox)) {
                // 메일함 주인이 다르면 메시지를 하나도 읽지 않는다 (R3). 이미 만든 카드는 보낸다 (RC-1)
                await this.deliverAlertsSafely();
                return await this.failRun("mailbox_mismatch");
            }

            await this.loadAddresses();
            if (this.config.syncMode === "on") await this.applyPendingEffects();

            if (!this.state.history_id) {
                await this.startCursor(profile.historyId);
            } else {
                try {
                    await this.processHistory(this.state.history_id);
                } catch (e) {
                    if (!(e instanceof GmailApiError) || e.code !== "history_expired") throw e;
                    // history가 너무 오래됨 → 마지막 성공 1시간 전부터 목록으로 이어 읽는다 (놓침 0, R37). 커서는 지금 값으로 새로
                    await this.restartFromList(profile.historyId);
                }
            }

            if (!this.overBudget()) await this.processBackfill();
            if (this.alertsLive()) await this.deliverAlerts();
        } catch (e) {
            if (e instanceof GmailApiError) {
                const code: ReplyErrorCode =
                    e.code === "auth" || e.code === "scope" || e.code === "rate_limited" || e.code === "config" ? e.code : "transient";
                console.warn(`[reply-sync] Gmail 오류 ${code}: ${describeReplyError(e)}`);
                // Gmail이 끊겨도 이미 만든 카드는 보낸다 — 토큰을 다시 받는 사이(주말 등) 카드가 24시간 뒤 버려지지 않게 (RC-1)
                await this.deliverAlertsSafely();
                return await this.failRun(code);
            }
            const pg = pgErrorOf(e);
            if (pg && isConnectionError(pg.code)) {
                console.error(`[reply-sync] DB 연결 오류로 멈춤: ${describeReplyError(e)}`);
                await this.failRun("db").catch(() => {});
            } else {
                // 분류 밖 오류(스키마 어긋남·코드 예외)도 상태에 남겨 띠·운영 알림·정체 판정이 돌게 한다 (RO-1). 오류는 다시 던진다 (라우트 500)
                console.error(`[reply-sync] 예상하지 못한 오류: ${describeReplyError(e)}`);
                await this.failRun("internal").catch(() => {});
            }
            throw e;
        }

        await this.saveSuccess();
        this.stats.gmailCalls = this.gmail.calls();
        console.log(`[reply-sync] mode=${this.config.syncMode} ${runSummaryLine(this.counts)} alertsSent=${this.stats.alerts.sent}${this.stats.budgetHit ? " budgetHit" : ""}`);
        return this.stats;
    }

    // ── 상태 ──

    private async loadState(): Promise<StateRow> {
        await db.execute(sql`
            INSERT INTO email_reply_mailbox_state (mailbox) VALUES (${this.config.mailbox}) ON CONFLICT (mailbox) DO NOTHING
        `);
        const r = rows<StateRow>(
            await db.execute(sql`
                SELECT mailbox, history_id, backfill_after, backfill_before, backfill_done_at, last_success_at,
                       last_error_code, last_error_at, ops_alerted_at, ops_alerted_code, ops_recovery_code, ops_recovered_at, stats
                FROM email_reply_mailbox_state WHERE mailbox = ${this.config.mailbox}
            `)
        );
        return r[0];
    }

    private async saveCursor(historyId: string): Promise<void> {
        await db.execute(sql`
            UPDATE email_reply_mailbox_state SET history_id = ${historyId}, updated_at = now() WHERE mailbox = ${this.config.mailbox}
        `);
        this.state.history_id = historyId;
    }

    private statsJson(): Record<string, unknown> {
        return {
            last: this.counts,
            today: mergeDailyCounts(this.state.stats, this.counts, this.now),
            excluded: this.ourSet?.excludedMasked ?? (this.state.stats?.excluded as string[] | undefined) ?? [],
            serverKind: this.config.serverKind,
            mode: this.config.syncMode,
            alertMode: this.config.alertMode,
            warnings: this.config.warnings.map((w) => w.code),
            gmailCalls: this.gmail.calls(),
        };
    }

    private async saveSuccess(): Promise<void> {
        const hadError = this.state.last_error_code;
        const alerted = toDate(this.state.ops_alerted_at);
        // 회복 글 빚: 알렸던 오류가 풀렸거나, 지난번 회복 글을 못 보냈다 (RO-6)
        const recoveryCode = hadError && alerted ? hadError : this.state.ops_recovery_code;
        await db.execute(sql`
            UPDATE email_reply_mailbox_state
            SET last_run_at = now(), last_success_at = now(), last_error_code = NULL, last_error = NULL, last_error_at = NULL,
                ops_alerted_at = NULL, ops_alerted_code = NULL, ops_recovery_code = ${recoveryCode},
                ops_recovered_at = ${hadError ? sql`now()` : sql`ops_recovered_at`},
                stats = ${JSON.stringify(this.statsJson())}::jsonb, updated_at = now()
            WHERE mailbox = ${this.config.mailbox}
        `);
        // 오류였다가 다시 되면 운영 스페이스에 한 번 (알렸던 경우만). 못 보내면 다음 성공 회차에 다시 (RO-6)
        if (recoveryCode) {
            const r = await this.postOps(buildOpsRecoveredMessage(recoveryCode, this.now, { serverLabel: replyServerLabel(this.config) }));
            if (r !== "failed") {
                await db.execute(sql`UPDATE email_reply_mailbox_state SET ops_recovery_code = NULL WHERE mailbox = ${this.config.mailbox}`);
            }
        }
        await notifyWebhookProblems({ env: this.env }).catch(() => {});
    }

    /**
     * 회차 실패: 상태에 오류를 남기고 필요하면 운영 알림 (6시간에 한 번, M7). 커서는 처리한 데까지 이미 저장했다.
     * on인데 마지막 성공이 6시간을 넘었으면 정체 알림을 함께 보낸다 (R61)
     */
    private async failRun(code: ReplyErrorCode): Promise<ReplySyncStats> {
        const firstErrorAt = this.state.last_error_code ? toDate(this.state.last_error_at) ?? this.now : this.now;
        const lastSuccessAt = toDate(this.state.last_success_at);
        const stale =
            this.config.syncMode === "on" && this.now.getTime() - (lastSuccessAt ?? firstErrorAt).getTime() > STALE_SYNC_MS;
        const errorText = stale ? `${replyErrorText(code)} (${replyErrorText("stale")})` : replyErrorText(code);
        const send =
            this.config.opsWebhook !== null &&
            shouldSendOpsAlert({
                code,
                stale,
                now: this.now,
                lastSuccessAt,
                firstErrorAt,
                opsAlertedAt: toDate(this.state.ops_alerted_at),
                opsAlertedCode: this.state.ops_alerted_code,
                recoveredAt: toDate(this.state.ops_recovered_at),
            });
        await db.execute(sql`
            UPDATE email_reply_mailbox_state
            SET last_run_at = now(), last_error_code = ${code}, last_error = ${errorText},
                last_error_at = ${firstErrorAt.toISOString()}::timestamptz,
                stats = ${JSON.stringify(this.statsJson())}::jsonb, updated_at = now()
            WHERE mailbox = ${this.config.mailbox}
        `);
        if (send) {
            // 원래 원인으로 할 일을 고르고, 원인을 첫 줄에 (RO-2·RC-15)
            const message = buildOpsAlertMessage(code, lastSuccessAt, {
                stale,
                syncMode: this.config.syncMode,
                serverLabel: replyServerLabel(this.config),
                baseUrl: this.config.baseUrl,
            });
            // 시간 초과(이미 올라갔을 수 있음)도 보낸 것으로 친다 — 5분마다 같은 경고가 두 통씩 쌓이지 않게 (RO-3)
            if ((await this.postOps(message)) !== "failed") {
                await db.execute(sql`
                    UPDATE email_reply_mailbox_state SET ops_alerted_at = now(), ops_alerted_code = ${code} WHERE mailbox = ${this.config.mailbox}
                `);
            }
        } else if (this.config.opsWebhook === null && (code === "auth" || code === "scope" || code === "mailbox_mismatch")) {
            console.warn("[reply-sync] 운영 알림 받는 곳 없음 (REPLY_OPS_WEBHOOK_URL·SEND_HEALTH_WEBHOOK_URL·DEEP_ALERT_WEBHOOK_URL) — 회신 탭 띠로만 알림");
        }
        this.stats.gmailCalls = this.gmail.calls();
        console.log(`[reply-sync] 실패 code=${code} ${runSummaryLine(this.counts)}`);
        if (code !== "db") await notifyWebhookProblems({ env: this.env }).catch(() => {});
        return { ...this.stats, error: code };
    }

    /** 운영 알림 한 통 */
    private async postOps(text: string): Promise<"sent" | "uncertain" | "failed"> {
        return postReplyOps(this.config, this.env, text);
    }

    /** 허용 목록에 있는데 웹훅이 없거나 형식이 틀린 사업을 남긴다 (운영 스페이스 알림 WPN-2). 고쳐졌으면 지운다 */
    private async recordWebhookConfig(): Promise<void> {
        for (const c of this.config.webhookChecks) {
            if (chatWebhookProblem(c.url)) await recordChatWebhookConfig(c.source, c.workspaceId, c.url);
            else await clearChatWebhookConfigProblem(c.source, c.workspaceId);
        }
    }

    // ── 주소 모음 (4-1) ──

    private async loadAddresses(): Promise<void> {
        const orgRows = rows<{ org_id: string }>(
            await db.execute(sql`SELECT DISTINCT org_id FROM workspaces WHERE id = ANY(${sql.param(this.config.workspaceIds)}::int[])`)
        );
        this.orgIds = orgRows.map((r) => r.org_id);
        const candidates: AddressCandidate[] = [];
        if (this.orgIds.length > 0) {
            const orgs = sql.param(this.orgIds);
            const profileRows = rows<{ email: string; org_id: string; source: "profile" | "config" }>(
                await db.execute(sql`
                    SELECT from_email AS email, org_id, 'profile' AS source FROM email_sender_profiles WHERE org_id = ANY(${orgs}::uuid[])
                    UNION ALL
                    SELECT from_email AS email, org_id, 'config' AS source FROM email_configs
                    WHERE org_id = ANY(${orgs}::uuid[]) AND from_email IS NOT NULL
                `)
            );
            for (const r of profileRows) candidates.push({ email: r.email, orgId: r.org_id, source: r.source });
            // 최근 90일 발송의 보낸 주소 (지운 프로필의 옛 주소, m2) — (org_id, sent_at) 색인이 있을 때만 (DESIGN-SND 8-3)
            if (await this.sendLogIndexReady()) {
                const since = new Date(this.now.getTime() - SENDER_LOG_LOOKBACK_DAYS * DAY_MS).toISOString();
                const logRows = rows<{ email: string; org_id: string }>(
                    await db.execute(sql`
                        SELECT DISTINCT lower(sender_email) AS email, org_id
                        FROM email_send_logs
                        WHERE org_id = ANY(${orgs}::uuid[]) AND sent_at >= ${since}::timestamptz AND sender_email IS NOT NULL
                    `)
                );
                for (const r of logRows) candidates.push({ email: r.email, orgId: r.org_id, source: "send_log" });
            }
            const userRows = rows<{ email: string; org_id: string }>(
                await db.execute(sql`
                    SELECT lower(u.email) AS email, u.org_id FROM users u WHERE u.org_id = ANY(${orgs}::uuid[])
                    UNION
                    SELECT lower(u.email) AS email, m.organization_id AS org_id
                    FROM organization_members m JOIN users u ON u.id = m.user_id
                    WHERE m.organization_id = ANY(${orgs}::uuid[])
                `)
            );
            for (const u of userRows) {
                const set = this.orgUsers.get(u.org_id) ?? new Set<string>();
                set.add(normalizeReplyAddress(u.email));
                this.orgUsers.set(u.org_id, set);
            }
        }
        this.ourSet = buildOurAddressSet({
            candidates,
            mailbox: this.config.mailbox,
            profileEmail: this.profileEmail,
            privateDomains: this.config.privateDomains,
            sharedDomainAddresses: this.config.sharedDomainAddresses,
            senderEmails: this.config.senderEmails,
        });
    }

    private async sendLogIndexReady(): Promise<boolean> {
        const r = rows<{ ok: boolean }>(
            await db.execute(sql`
                SELECT EXISTS (
                    SELECT 1 FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
                    WHERE c.relname = 'email_send_logs_org_sent_at_idx' AND i.indisvalid
                ) AS ok
            `)
        );
        return r[0]?.ok === true;
    }

    // ── 새 메일 번호 (6절) ──

    /** 처음 회차: 지금 history를 커서로 잡고 거슬러 읽기 범위를 정한다 (R38) */
    private async startCursor(historyId: string): Promise<void> {
        const after = new Date(this.now.getTime() - this.config.backfillDays * DAY_MS);
        const done = this.config.backfillDays === 0;
        await db.execute(sql`
            UPDATE email_reply_mailbox_state
            SET history_id = ${historyId}, backfill_after = ${after.toISOString()}::timestamptz,
                backfill_before = ${this.now.toISOString()}::timestamptz,
                backfill_done_at = ${done ? this.now.toISOString() : null}::timestamptz, updated_at = now()
            WHERE mailbox = ${this.config.mailbox}
        `);
        this.state.history_id = historyId;
        this.state.backfill_after = after;
        this.state.backfill_before = this.now;
        this.state.backfill_done_at = done ? this.now : null;
    }

    /**
     * history 404: 마지막 성공 1시간 전부터 지금까지를 거슬러 읽기 창에 넣고 커서를 지금 값으로 새로 잡는다.
     * 거슬러 읽기가 회차를 넘겨 이어 읽으므로 한 회차에 다 못 읽어도 놓치지 않는다 (진행 중이던 처음 거슬러 읽기와 합친다)
     */
    private async restartFromList(currentHistoryId: string): Promise<void> {
        const after = fallbackListAfter(toDate(this.state.last_success_at), this.now);
        const prevAfter = this.state.backfill_done_at ? null : toDate(this.state.backfill_after);
        const mergedAfter = prevAfter && prevAfter.getTime() < after.getTime() ? prevAfter : after;
        await db.execute(sql`
            UPDATE email_reply_mailbox_state
            SET history_id = ${currentHistoryId}, backfill_after = ${mergedAfter.toISOString()}::timestamptz,
                backfill_before = ${this.now.toISOString()}::timestamptz, backfill_done_at = NULL, updated_at = now()
            WHERE mailbox = ${this.config.mailbox}
        `);
        this.state.history_id = currentHistoryId;
        this.state.backfill_after = mergedAfter;
        this.state.backfill_before = this.now;
        this.state.backfill_done_at = null;
        console.log("[reply-sync] history 커서가 너무 오래됨 — 목록 조회로 이어 읽음");
    }

    /** history 이어 읽기 — 묶음(기록 단위)마다 커서를 그 묶음의 마지막 기록 번호로 옮긴다 */
    private async processHistory(startHistoryId: string): Promise<void> {
        const entries: Entry[] = [];
        let pageToken: string | undefined;
        let latest = startHistoryId;
        let complete = true;
        do {
            const page = await this.gmail.listHistory(startHistoryId, pageToken);
            latest = page.historyId || latest;
            for (const h of page.history ?? []) {
                for (const m of h.messagesAdded ?? []) {
                    entries.push({ historyId: h.id, id: m.message.id, labelIds: m.message.labelIds ?? null });
                }
            }
            pageToken = page.nextPageToken;
            if (pageToken && entries.length >= STAGE1_MAX_PER_RUN + PROCESS_BATCH_SIZE) {
                complete = false;
                break;
            }
        } while (pageToken);

        let cursor = startHistoryId;
        let i = 0;
        while (i < entries.length) {
            if (this.overBudget() || this.stage1Left <= 0) {
                this.stats.budgetHit = true;
                break;
            }
            // 기록 단위로 묶는다 (한 기록의 메일을 묶음 사이에 가르지 않는다)
            let end = i;
            while (end < entries.length && (end - i < PROCESS_BATCH_SIZE || entries[end].historyId === entries[end - 1].historyId)) end++;
            const batch = entries.slice(i, end);
            const { done } = await this.processEntries(batch);
            if (done > 0) {
                cursor = batch[done - 1].historyId ?? cursor;
                await this.saveCursor(cursor);
            }
            if (done < batch.length) {
                this.stats.budgetHit = true;
                break;
            }
            i = end;
        }
        // 모두 읽었으면 응답의 historyId로 (메일 없는 기록까지 건너뛴다)
        if (complete && i >= entries.length && !this.stats.budgetHit && latest !== cursor) await this.saveCursor(latest);
    }

    /** 처음 거슬러 읽기·history 404 이어 읽기 (최근 것부터, R38) */
    private async processBackfill(): Promise<void> {
        if (this.state.backfill_done_at) return;
        const after = toDate(this.state.backfill_after);
        let before = toDate(this.state.backfill_before);
        if (!after || !before) return;
        this.stats.backfill.active = true;

        while (!this.overBudget() && this.stage1Left > 0) {
            if (before.getTime() <= after.getTime()) {
                await this.markBackfillDone();
                return;
            }
            const page = await this.gmail.listMessages(backfillListQuery(after, before), undefined, Math.min(500, this.stage1Left));
            const raw = page.messages ?? [];
            const ids = raw.filter((m) => !this.seen.has(m.id));
            if (ids.length === 0) {
                // 비었거나 이번 회차에 이미 본 메일뿐 — 다음 쪽이 없으면 끝, 있으면 다음 회차가 이어 간다
                if (raw.length === 0 || !page.nextPageToken) await this.markBackfillDone();
                else this.stats.budgetHit = true;
                return;
            }
            const entries: Entry[] = ids.map((m) => ({ historyId: null, id: m.id, labelIds: null }));
            let cutEarly = false;
            let earliest: number | null = null;
            for (let i = 0; i < entries.length; i += PROCESS_BATCH_SIZE) {
                const batch = entries.slice(i, i + PROCESS_BATCH_SIZE);
                const res = await this.processEntries(batch);
                if (res.earliest !== null && (earliest === null || res.earliest < earliest)) earliest = res.earliest;
                if (res.done < batch.length || (this.overBudget() && i + PROCESS_BATCH_SIZE < entries.length)) {
                    cutEarly = true;
                    break;
                }
            }
            if (!cutEarly && !page.nextPageToken) {
                // 이 창의 목록을 다 읽었다
                await this.markBackfillDone();
                return;
            }
            if (earliest !== null) {
                // 처리한 가장 이른 메일이 든 초까지 포함해 창을 당긴다 (경계의 같은 메일은 유일 키가 막는다)
                before = nextBackfillBefore(earliest);
                await db.execute(sql`
                    UPDATE email_reply_mailbox_state SET backfill_before = ${before.toISOString()}::timestamptz, updated_at = now()
                    WHERE mailbox = ${this.config.mailbox}
                `);
                this.state.backfill_before = before;
            }
            if (cutEarly) {
                this.stats.budgetHit = true;
                return;
            }
        }
        if (!this.state.backfill_done_at) this.stats.budgetHit = true;
    }

    private async markBackfillDone(): Promise<void> {
        await db.execute(sql`
            UPDATE email_reply_mailbox_state SET backfill_done_at = now(), updated_at = now() WHERE mailbox = ${this.config.mailbox}
        `);
        this.state.backfill_done_at = this.now;
        this.stats.backfill.done = true;
    }

    // ── 묶음 처리 (4-2 → 5 → 6 → 7) ──

    /**
     * 메일 묶음 하나를 처리한다. 돌려주는 값: 앞에서부터 끝낸 메일 수(기록 단위로 끊는다 — 커서를 그 앞까지 옮긴다)와
     * 끝낸 메일 중 가장 이른 도착 시각 (거슬러 읽기 창을 당기는 데 쓴다).
     * 본문 한도(회차 50통)에 닿으면 그 메일이 든 기록 앞에서 끊는다. DB 연결 오류는 던진다 (커서는 이 묶음 앞).
     */
    private async processEntries(batch: Entry[]): Promise<{ done: number; earliest: number | null }> {
        // 이 회차에 이미 본 메일·라벨로 버릴 메일
        const work: Array<{ index: number; entry: Entry }> = [];
        const inBatch = new Set<string>();
        for (let i = 0; i < batch.length; i++) {
            const e = batch[i];
            // history가 같은 번호를 두 번 줘도 한 번만 읽는다 (유일 키가 한 번 더 막는다)
            if (this.seen.has(e.id) || inBatch.has(e.id)) continue;
            inBatch.add(e.id);
            if (e.labelIds && isSkippedLabel(e.labelIds)) {
                this.seen.add(e.id);
                this.counts.skippedLabel++;
                continue;
            }
            work.push({ index: i, entry: e });
        }
        if (work.length > this.stage1Left) {
            // 1단계 한도 — 넘는 메일이 든 기록 앞에서 끊는다
            const cut = this.cutAtRecord(batch, work[this.stage1Left].index);
            for (const w of work) if (w.index >= cut) this.seen.delete(w.entry.id);
            return cut === 0 ? { done: 0, earliest: null } : this.processEntries(batch.slice(0, cut));
        }

        // 1단계: 받는 사람·스레드 머리글만 (모든 새 메일)
        const metas = await mapLimit(work, GMAIL_CONCURRENCY, (w) => this.gmail.getMessageRecipients(w.entry.id));
        this.stage1Left -= work.length;
        this.counts.listed += work.length;
        const internalDates = new Map<number, number>();

        type Ours = { index: number; entry: Entry; meta: GmailMessage; ownership: ParsedMessage["ownership"] };
        const ours: Ours[] = [];
        const domainChecks: Array<{ index: number; entry: Entry; meta: GmailMessage; address: string; orgIds: string[]; cands: string[] }> = [];
        for (let k = 0; k < work.length; k++) {
            const { index, entry } = work[k];
            const meta = metas[k];
            this.seen.add(entry.id);
            if (!meta) {
                this.counts.gone++;
                continue;
            }
            const internal = Number(meta.internalDate ?? 0);
            if (internal > 0) internalDates.set(index, internal);
            if (isSkippedLabel(meta.labelIds)) {
                this.counts.skippedLabel++;
                continue;
            }
            const headers = meta.payload?.headers ?? [];
            const own = recipientOwnership(headers, this.ourSet);
            if (own.kind === "address") {
                ours.push({ index, entry, meta, ownership: { reason: "address", address: own.address, orgIds: own.orgIds } });
            } else if (own.kind === "domain") {
                const cands = threadRequestIdCandidates(headerValues(headers, "In-Reply-To"), headerValues(headers, "References"));
                if (cands.length === 0) this.counts.notOurs++;
                else domainChecks.push({ index, entry, meta, address: own.address, orgIds: own.orgIds, cands });
            } else {
                // 남의 메일 — 2단계로 가지 않는다. 번호·해시도 남기지 않는다 (건수만)
                this.counts.notOurs++;
            }
        }
        // 도메인만 같은 메일: 스레드가 우리 발송에 이어질 때만 우리 것 (domain_thread, R6)
        if (domainChecks.length > 0) {
            const logs = await this.lookupThreadLogs(domainChecks.flatMap((d) => d.cands));
            for (const d of domainChecks) {
                const pick = pickThreadLog(d.cands, logs, d.orgIds);
                if (pick.status === "matched") {
                    ours.push({ index: d.index, entry: d.entry, meta: d.meta, ownership: { reason: "domain_thread", address: d.address, orgIds: d.orgIds } });
                } else {
                    this.counts.notOurs++;
                }
            }
            ours.sort((a, b) => a.index - b.index);
        }

        // 본문 한도: 넘는 메일이 든 기록 앞에서 끊는다
        let doneCount = batch.length;
        let oursInRun = ours;
        if (ours.length > this.bodyLeft) {
            const cut = this.cutAtRecord(batch, ours[this.bodyLeft].index);
            doneCount = cut;
            oursInRun = ours.filter((o) => o.index < cut);
            // 끊긴 뒤 메일은 다음 회차가 다시 읽는다 (seen에서 뺀다)
            for (const w of work) if (w.index >= cut) this.seen.delete(w.entry.id);
        }

        const parsed: ParsedMessage[] = [];
        for (const o of oursInRun) {
            const p = await this.readOurMessage(o.entry, o.meta, o.ownership);
            if (p) parsed.push(p);
        }
        if (parsed.length > 0) await this.matchAndStore(parsed);
        let earliest: number | null = null;
        for (const [index, ms] of internalDates) if (index < doneCount && (earliest === null || ms < earliest)) earliest = ms;
        return { done: doneCount, earliest };
    }

    /** index가 든 history 기록의 첫 메일 위치 (기록 번호가 없으면 index 그대로) */
    private cutAtRecord(batch: Entry[], index: number): number {
        const hid = batch[index].historyId;
        if (hid === null) return index;
        let i = index;
        while (i > 0 && batch[i - 1].historyId === hid) i--;
        return i;
    }

    /**
     * 우리 것 하나: (시험 서버) 1.5단계 From → 2단계 본문 → 보낸 사람 확인 → 보고 부분 → 분류·발췌.
     * 저장하지 않을 메일이면 null (직원 주소가 아님·우리 자신이 보냄·지워짐)
     */
    private async readOurMessage(entry: Entry, meta: GmailMessage, ownership: ParsedMessage["ownership"]): Promise<ParsedMessage | null> {
        this.counts.ours++;
        if (this.config.serverKind === "test") {
            // 시험 서버: 직원 주소가 보낸 메일만 2단계로 (M1). 값이 없으면 모두 버린다
            const fromMeta = this.config.allowedFrom ? await this.gmail.getMessageFrom(entry.id) : null;
            const from = fromMeta ? normalizeReplyAddress(parseAddressList(headerValue(fromMeta.payload?.headers, "From"))[0]?.address) : "";
            if (!this.config.allowedFrom || !from || !this.config.allowedFrom.includes(from)) {
                this.counts.notAllowedFrom++;
                return null;
            }
        }

        const big = (meta.sizeEstimate ?? 0) > FULL_FORMAT_MAX_BYTES;
        const full = big ? await this.gmail.getMessageAllHeaders(entry.id) : await this.gmail.getMessageFull(entry.id);
        this.bodyLeft--;
        this.counts.bodyFetched++;
        if (!full) {
            this.counts.gone++;
            return null;
        }
        const payload = full.payload ?? {};
        const headers = payload.headers ?? [];
        const receivedAt = new Date(Number(full.internalDate ?? meta.internalDate ?? Date.now()));
        const fromParsed = parseAddressList(headerValue(headers, "From"))[0] ?? { name: "", address: "" };
        const fromEmail = normalizeReplyAddress(fromParsed.address);

        // 보낸 사람이 메일함 주인이거나 우리 발신 주소면(대표님 시험 메일·자기에게 보낸 메일) 버린다 (R8)
        if (!fromEmail || this.ourSet.mailboxAddresses.has(fromEmail) || this.ourSet.addresses.has(fromEmail)) {
            this.counts.skippedSelf++;
            return null;
        }

        const base: ParsedMessage = {
            entry,
            gmailId: entry.id,
            threadId: full.threadId ?? meta.threadId ?? null,
            labelIds: full.labelIds ?? meta.labelIds ?? [],
            receivedAt,
            ownership,
            fromEmail,
            fromName: clip(fromParsed.name || null, 200),
            subject: null,
            rfcMessageId: null,
            classification: { kind: "unknown", reportType: null },
            excerpt: null,
            unsubscribeHint: false,
            threadCandidates: [],
            dsnRecipients: [],
            feedbackRecipient: null,
            parseError: null,
        };
        try {
            const subject = decodeMimeWords(headerValue(headers, "Subject") ?? "").replace(/\s+/g, " ").trim();
            base.subject = clip(subject, 300);
            base.rfcMessageId = clip(parseMessageIds(headerValue(headers, "Message-ID"))[0] ?? null, 300);

            // 반송·시스템 안내의 보고 부분이 첨부로 왔으면 그 부분만 (M9)
            const fetched = new Map<string, string>();
            if (!big) {
                for (const ref of reportPartsToFetch(payload, fromEmail)) {
                    const part = await this.gmail.getReportPart(entry.id, ref.attachmentId);
                    if (part) {
                        fetched.set(ref.attachmentId, part.data);
                        this.counts.reportParts++;
                    }
                }
            }
            const bodies = big ? { text: null, html: null, deliveryStatus: null, originalHeaders: null, feedbackReport: null } : extractBodies(payload, fetched);

            const orgUsers = new Set<string>();
            for (const org of ownership.orgIds) for (const u of this.orgUsers.get(org) ?? []) orgUsers.add(u);
            base.classification = classifyReply(
                { headers, from: fromEmail, subject },
                { orgUserEmails: orgUsers, mailboxDomains: this.ourSet.mailboxDomains }
            );
            const kind = base.classification.kind;
            if (kind === "bounce" || kind === "system") {
                // 반송·시스템 안내는 발췌를 남기지 않는다 (DSN 본문은 우리 원래 메일의 사본이다). 원본 Message-ID로 잇는다
                const original = originalMessageIdOf(bodies.originalHeaders);
                base.threadCandidates = original ? requestIdCandidatesOf(original) : [];
                base.dsnRecipients = parseDeliveryStatus(bodies.deliveryStatus);
                base.feedbackRecipient = feedbackRecipientOf(bodies.feedbackReport);
            } else {
                base.threadCandidates = threadRequestIdCandidates(headerValues(headers, "In-Reply-To"), headerValues(headers, "References"));
                const text = big ? "" : replyTextOf(bodies);
                base.excerpt = big ? null : makeExcerpt(text, EXCERPT_MAX_CHARS) || null;
                base.unsubscribeHint = kind === "human" && hasUnsubscribeHint(subject, text);
            }
        } catch (e) {
            // 메일 하나의 해석 오류 — 우리 것이니 unknown 줄만 남긴다 (오류 글은 짧게, 내용 없음)
            base.classification = { kind: "unknown", reportType: null };
            base.parseError = `parse ${e instanceof Error ? e.name : "error"}`.slice(0, 80);
        }
        countKind(this.counts, base.classification.kind);
        return base;
    }

    // ── 짝짓기 (6절) ──

    private async lookupThreadLogs(cands: string[]): Promise<Array<LogRow & { requestId: string | null; orgId: string }>> {
        const unique = [...new Set(cands)];
        if (unique.length === 0 || this.orgIds.length === 0) return [];
        const r = rows<LogRow>(
            await db.execute(sql`
                SELECT ${LOG_COLUMNS}
                FROM email_send_logs l ${LOG_JOINS}
                WHERE l.request_id = ANY(${sql.param(unique)}::text[]) AND l.org_id = ANY(${sql.param(this.orgIds)}::uuid[])
            `)
        );
        return r.map((row) => ({ ...row, requestId: row.request_id, orgId: row.org_id }));
    }

    private async lookupFallbackLogs(emails: string[], since: Date): Promise<LogCandidate[]> {
        if (emails.length === 0 || this.orgIds.length === 0) return [];
        const r = rows<LogRow>(
            await db.execute(sql`
                SELECT ${LOG_COLUMNS}
                FROM email_send_logs l ${LOG_JOINS}
                WHERE l.org_id = ANY(${sql.param(this.orgIds)}::uuid[]) AND l.sent_at >= ${since.toISOString()}::timestamptz
                  AND lower(btrim(l.recipient_email, ${EMAIL_TRIM_CHARS}::text)) = ANY(${sql.param(emails)}::text[])
                ORDER BY l.sent_at DESC
                LIMIT 1000
            `)
        );
        return r.map((row) => this.toCandidate(row));
    }

    private toCandidate(row: LogRow): LogCandidate {
        return {
            id: row.id,
            orgId: row.org_id,
            workspaceId: row.workspace_id,
            recipientEmail: row.recipient_email,
            senderEmail: row.sender_email,
            profileFromEmail: row.profile_from_email,
            subject: row.subject,
            sentAt: toDate(row.sent_at) ?? new Date(0),
            row,
            requestId: row.request_id,
        };
    }

    /** 6-4: parent_log_id 사슬을 거슬러 첫 메일까지 (최대 10번, 한 문장). 트랜잭션 안에서 부르면 exec = tx */
    private async loadChains(logIds: number[], exec: DbExec = db): Promise<Map<number, ChainInfo>> {
        const out = new Map<number, ChainInfo>();
        const unique = [...new Set(logIds)];
        if (unique.length === 0) return out;
        const r = rows<{ start_id: number; root_id: number; depth: number; auto_personalized_link_id: number | null; template_link_id: number | null }>(
            await exec.execute(sql`
                WITH RECURSIVE chain AS (
                    SELECT l.id AS start_id, l.id, l.parent_log_id, l.org_id, 0 AS depth
                    FROM email_send_logs l WHERE l.id = ANY(${sql.param(unique)}::int[])
                    UNION ALL
                    SELECT c.start_id, p.id, p.parent_log_id, p.org_id, c.depth + 1
                    FROM chain c JOIN email_send_logs p ON p.id = c.parent_log_id AND p.org_id = c.org_id
                    WHERE c.depth < ${CHAIN_MAX_DEPTH}
                )
                SELECT DISTINCT ON (c.start_id) c.start_id, c.id AS root_id, c.depth,
                       r.auto_personalized_link_id, r.template_link_id
                FROM chain c JOIN email_send_logs r ON r.id = c.id
                ORDER BY c.start_id, c.depth DESC
            `)
        );
        for (const x of r) {
            const rule = ruleOf({ autoPersonalizedLinkId: x.auto_personalized_link_id, templateLinkId: x.template_link_id });
            out.set(x.start_id, { rootId: x.root_id, depth: x.depth, ruleKind: rule.kind, ruleId: rule.id });
        }
        return out;
    }

    /** 6-3: 그 우리 주소로 최근 60일 보낸 발송의 워크스페이스가 하나뿐이면 그 워크스페이스 (허용 목록 안일 때만) */
    private async guessWorkspaces(addresses: string[]): Promise<Map<string, number>> {
        const out = new Map<string, number>();
        const unique = [...new Set(addresses)];
        if (unique.length === 0 || this.orgIds.length === 0) return out;
        const since = new Date(this.now.getTime() - MATCH_WINDOW_DAYS * DAY_MS).toISOString();
        const r = rows<{ sender: string; workspaces: number[] }>(
            await db.execute(sql`
                SELECT lower(COALESCE(l.sender_email, sp.from_email)) AS sender, array_agg(DISTINCT p.workspace_id) AS workspaces
                FROM email_send_logs l
                LEFT JOIN email_sender_profiles sp ON sp.id = l.sender_profile_id AND sp.org_id = l.org_id
                JOIN partitions p ON p.id = l.partition_id
                WHERE l.org_id = ANY(${sql.param(this.orgIds)}::uuid[]) AND l.sent_at >= ${since}::timestamptz
                  AND lower(COALESCE(l.sender_email, sp.from_email)) = ANY(${sql.param(unique)}::text[])
                GROUP BY 1
            `)
        );
        for (const x of r) {
            const list = (x.workspaces ?? []).filter((w) => w !== null);
            if (list.length === 1 && this.config.workspaceIds.includes(list[0])) out.set(normalizeReplyAddress(x.sender), list[0]);
        }
        return out;
    }

    /** 단일 조직이면 그 조직 (애매함·못 이음 줄을 관리자 화면에 보이게) */
    private singleOrg(orgIds: string[]): string | null {
        return orgIds.length === 1 ? orgIds[0] : null;
    }

    private async matchAndStore(parsed: ParsedMessage[]): Promise<void> {
        // 6-1 스레드 머리글 (반송·시스템 안내는 원본 Message-ID)
        const threadLogs = await this.lookupThreadLogs(parsed.flatMap((p) => p.threadCandidates));
        const decisions = new Map<ParsedMessage, MatchDecision>();
        const needFallback: ParsedMessage[] = [];
        for (const p of parsed) {
            const pick = pickThreadLog(p.threadCandidates, threadLogs, p.ownership.orgIds);
            if (pick.status === "matched") {
                const kind = p.classification.kind;
                decisions.set(p, {
                    status: "matched",
                    method: kind === "bounce" || kind === "system" ? "dsn_headers" : "thread",
                    log: pick.log,
                    orgId: pick.log.org_id,
                    workspaceId: pick.log.workspace_id,
                    workspaceGuessed: false,
                });
            } else if (pick.status === "ambiguous") {
                decisions.set(p, { status: "ambiguous", method: "thread", log: null, orgId: null, workspaceId: null, workspaceGuessed: false });
            } else if (p.classification.kind === "bounce" || p.classification.kind === "system") {
                // 반송은 6-2 대체 짝짓기를 쓰지 않는다 — SND가 Final-Recipient·받은 주소·7일로 잇는다 (B2)
                decisions.set(p, {
                    status: "unmatched",
                    method: null,
                    log: null,
                    orgId: this.singleOrg(p.ownership.orgIds),
                    workspaceId: null,
                    workspaceGuessed: false,
                });
            } else {
                needFallback.push(p);
            }
        }

        // 6-2 대체 짝짓기 (보낸 사람·받은 주소·60일·제목)
        if (needFallback.length > 0) {
            const earliest = Math.min(...needFallback.map((p) => p.receivedAt.getTime()));
            const emails = [...new Set(needFallback.flatMap((p) => addressVariants(p.fromEmail)))];
            const candidates = await this.lookupFallbackLogs(emails, new Date(earliest - MATCH_WINDOW_DAYS * DAY_MS));
            for (const p of needFallback) {
                const pick = pickFallbackLog({
                    logs: candidates,
                    from: p.fromEmail,
                    toAddress: p.ownership.address,
                    orgIds: p.ownership.orgIds,
                    receivedAt: p.receivedAt,
                    subject: p.subject,
                });
                if (pick.status === "matched") {
                    decisions.set(p, {
                        status: "matched",
                        method: pick.method,
                        log: pick.log.row,
                        orgId: pick.log.orgId,
                        workspaceId: pick.log.workspaceId,
                        workspaceGuessed: false,
                    });
                } else if (pick.status === "ambiguous") {
                    decisions.set(p, {
                        status: "ambiguous",
                        method: pick.method,
                        log: null,
                        orgId: pick.method === "fallback_multi_ws" ? this.singleOrg(p.ownership.orgIds) : null,
                        workspaceId: null,
                        workspaceGuessed: false,
                    });
                } else {
                    decisions.set(p, { status: "unmatched", method: null, log: null, orgId: this.singleOrg(p.ownership.orgIds), workspaceId: null, workspaceGuessed: false });
                }
            }
            // 6-3 사업 추정 (못 이은 사람 회신만)
            const guessFor = needFallback.filter((p) => decisions.get(p)?.status === "unmatched" && p.classification.kind === "human");
            if (guessFor.length > 0) {
                const guesses = await this.guessWorkspaces(guessFor.map((p) => p.ownership.address));
                for (const p of guessFor) {
                    const ws = guesses.get(p.ownership.address);
                    const d = decisions.get(p)!;
                    if (ws !== undefined && d.orgId) decisions.set(p, { ...d, workspaceId: ws, workspaceGuessed: true });
                }
            }
        }

        const chains = await this.loadChains(
            [...decisions.values()].filter((d) => d.status === "matched" && d.log).map((d) => d.log!.id)
        );

        for (const p of parsed) {
            const d = decisions.get(p)!;
            // 이어진 발송의 워크스페이스가 허용 목록 밖이면 저장하지 않는다 (m8, R59)
            if (d.status === "matched" && (d.workspaceId === null || !this.config.workspaceIds.includes(d.workspaceId))) {
                this.counts.outOfScope++;
                continue;
            }
            // 스팸 라벨이면서 못 이은 메일은 저장하지 않는다 (R9)
            if (isSpamLabel(p.labelIds) && d.status !== "matched") {
                this.counts.skippedSpam++;
                continue;
            }
            await this.storeOne(p, d, d.log ? chains.get(d.log.id) ?? null : null);
        }
    }

    // ── 저장·효과 (7절) ──

    /**
     * 메일 하나 = 트랜잭션 하나 (M6 메일 하나 격리): 저장 → (반송) SND 신호 → (사람·on) 효과 차지·멈춤 → 알림 줄.
     * 데이터 오류(22·23)·그 밖의 오류는 되돌리고 최소 줄(unknown, process_error)만 남긴 뒤 다음 메일로 (커서는 넘어간다).
     * 연결·자원 오류만 던진다 (회차를 멈추고 커서를 그 묶음 앞에 둔다)
     */
    private async storeOne(p: ParsedMessage, d: MatchDecision, chain: ChainInfo | null): Promise<void> {
        try {
            await db.transaction(async (tx) => {
                await this.storeInTx(tx, p, d, chain);
            });
        } catch (e) {
            const pg = pgErrorOf(e);
            if (pg && isConnectionError(pg.code)) throw e;
            const errorText = pg ? processErrorText(pg.code, pg.constraint) : "error";
            console.warn(`[reply-sync] 메일 하나 저장 실패, 최소 줄만 남김: ${pg ? errorText : describeReplyError(e)}`);
            this.counts.dbErrors++;
            await this.storeMinimal(p, errorText).catch((e2: unknown) => {
                const pg2 = pgErrorOf(e2);
                if (pg2 && isConnectionError(pg2.code)) throw e2;
                console.warn(`[reply-sync] 최소 줄도 남기지 못함: ${describeReplyError(e2)}`);
            });
        }
    }

    private async storeMinimal(p: ParsedMessage, errorText: string): Promise<void> {
        await db.execute(sql`
            INSERT INTO email_replies
                (org_id, mailbox, gmail_message_id, gmail_thread_id, from_email, to_email, contact_email, kind,
                 ours_reason, match_status, received_at, detected_mode, process_error, stop_automation)
            VALUES (${this.singleOrg(p.ownership.orgIds)}::uuid, ${this.config.mailbox}, ${p.gmailId}, ${p.threadId},
                    ${clip(p.fromEmail, 200)}, ${clip(p.ownership.address, 200)}, ${clip(p.fromEmail, 200)}, 'unknown',
                    ${p.ownership.reason}, 'unmatched', ${p.receivedAt.toISOString()}::timestamptz, ${this.config.syncMode},
                    ${errorText.slice(0, 80)}, false)
            ON CONFLICT DO NOTHING
        `);
    }

    private async storeInTx(tx: DbTx, p: ParsedMessage, d: MatchDecision, chain: ChainInfo | null): Promise<void> {
        const kind: ReplyKind = p.classification.kind;
        const log = d.log;
        const isBounce = kind === "bounce";
        const bounceRecipient = p.dsnRecipients[0] ? p.dsnRecipients[0].finalRecipient ?? p.dsnRecipients[0].originalRecipient : null;
        const contactEmail = isBounce
            ? normalizeReplyAddress(bounceRecipient ?? log?.recipient_email ?? p.fromEmail)
            : p.fromEmail;
        const matchedRecipient = log ? normalizeReplyAddress(log.recipient_email) : null;
        const bounceType = isBounce ? bounceTypeOf(p.dsnRecipients) : null;

        const inserted = rows<{ id: number }>(
            await tx.execute(sql`
                INSERT INTO email_replies
                    (org_id, workspace_id, workspace_guessed, record_id, send_log_id, root_log_id, rule_kind, rule_id, step_index,
                     mailbox, gmail_message_id, gmail_thread_id, rfc_message_id, from_email, from_name, to_email, contact_email,
                     matched_recipient, subject, excerpt, kind, bounce_type, dsn_status, dsn_diagnostic, unsubscribe_hint,
                     ours_reason, match_status, match_method, received_at, detected_mode, process_error)
                VALUES (${d.orgId}::uuid, ${d.workspaceId}::int, ${d.workspaceGuessed}, ${log?.record_id ?? null}::int,
                        ${log?.id ?? null}::int, ${chain?.rootId ?? null}::int, ${chain?.ruleKind ?? null}, ${chain?.ruleId ?? null}::int,
                        ${chain?.depth ?? null}::int, ${this.config.mailbox}, ${p.gmailId}, ${p.threadId}, ${p.rfcMessageId},
                        ${clip(p.fromEmail, 200)}, ${p.fromName}, ${clip(p.ownership.address, 200)}, ${clip(contactEmail, 200)},
                        ${clip(matchedRecipient, 200)}, ${p.subject}, ${isBounce || kind === "system" ? null : p.excerpt}, ${kind},
                        ${bounceType}, ${clip(p.dsnRecipients[0]?.status ?? null, 20)}, ${clip(p.dsnRecipients[0]?.diagnostic ?? null, 300)},
                        ${p.unsubscribeHint}, ${p.ownership.reason}, ${d.status}, ${d.method}, ${p.receivedAt.toISOString()}::timestamptz,
                        ${this.config.syncMode}, ${p.parseError})
                ON CONFLICT DO NOTHING
                RETURNING id
            `)
        );
        if (inserted.length === 0) {
            // 두 회차가 겹치거나 history가 같은 번호를 두 번 줘도 줄 1개 (R30)
            this.counts.duplicates++;
            return;
        }
        const replyId = inserted[0].id;
        this.counts.stored++;
        if (d.status === "matched") this.counts.matched++;
        else if (d.status === "ambiguous") this.counts.ambiguous++;
        else this.counts.unmatched++;

        if (p.parseError) return;
        const on = this.config.syncMode === "on";

        // 반송·스팸 신고 → SND (7-3). 발송 기록은 SND가 쓴다
        if (isBounce || (kind === "system" && p.classification.reportType === "feedback-report")) {
            await this.handleBounce(tx, replyId, p, d, on);
            return;
        }

        if (kind !== "human") return;
        const target = replyAlertTarget({
            kind,
            matchStatus: d.status,
            workspaceId: d.workspaceId,
            workspaceGuessed: d.workspaceGuessed,
            allowedWorkspaceIds: this.config.workspaceIds,
        });

        let stopped: { followups: number; automation: number; sendQueue: number } | null = null;
        if (d.status === "matched" && d.orgId && d.workspaceId !== null) {
            const input: HumanReplyEffectsInput = {
                id: replyId,
                kind,
                matchStatus: d.status,
                orgId: d.orgId,
                workspaceId: d.workspaceId,
                recordId: log?.record_id ?? null,
                contactEmail,
                matchedRecipient,
                receivedAt: p.receivedAt,
                sendLogId: log?.id ?? null,
                ruleKind: chain?.ruleKind ?? null,
                ruleId: chain?.ruleId ?? null,
                stepIndex: chain?.depth ?? null,
            };
            if (on) {
                if (await claimReplyEffects(tx, replyId, "human", "first")) {
                    const res = await stopAutomationForReply(tx, input, { dryRun: false });
                    stopped = res;
                    this.counts.effectsApplied++;
                    await tx.execute(sql`
                        UPDATE email_replies SET effects = ${JSON.stringify({
                            followupsCancelled: res.followups,
                            automationCancelled: res.automation,
                            sendQueueSkipped: res.sendQueue,
                            recordEventId: res.recordEventId,
                        })}::jsonb WHERE id = ${replyId}::int
                    `);
                }
            } else {
                // dry_run: 같은 조건의 count만 — "멈출 예정" 숫자
                const res = await stopAutomationForReply(tx, input, { dryRun: true });
                stopped = res;
                await tx.execute(sql`
                    UPDATE email_replies SET effects = ${JSON.stringify({
                        preview: true,
                        followupsCancelled: res.followups,
                        automationCancelled: res.automation,
                        sendQueueSkipped: res.sendQueue,
                    })}::jsonb WHERE id = ${replyId}::int
                `);
            }
        }

        if (target) {
            await this.writeAlertRow(tx, replyId, p, d, chain, target, stopped, !on);
        }
    }

    /** 알림 줄 (효과 차지와 같은 트랜잭션, m1) */
    private async writeAlertRow(
        tx: DbExec,
        replyId: number,
        p: ParsedMessage,
        d: MatchDecision,
        chain: ChainInfo | null,
        target: "matched" | "unmatched",
        stopped: { followups: number; automation: number; sendQueue: number } | null,
        preview: boolean
    ): Promise<void> {
        const status = replyAlertStatus({
            syncMode: this.config.syncMode,
            alertMode: this.config.alertMode,
            receivedAt: p.receivedAt,
            now: this.now,
            lastSuccessAt: toDate(this.state.last_success_at),
        });
        if (!status) return;
        const card: CardReply = {
            id: replyId,
            orgId: d.orgId,
            workspaceId: d.workspaceId,
            recordId: d.log?.record_id ?? null,
            sendLogId: d.log?.id ?? null,
            rootLogId: chain?.rootId ?? null,
            ruleKind: chain?.ruleKind ?? null,
            ruleId: chain?.ruleId ?? null,
            stepIndex: chain?.depth ?? null,
            fromName: p.fromName,
            fromEmail: p.fromEmail,
            toEmail: p.ownership.address,
            subject: p.subject,
            excerpt: p.excerpt,
            receivedAt: p.receivedAt,
            unsubscribeHint: p.unsubscribeHint,
        };
        const message = await buildAlertMessageFor(tx, card, target, { now: this.now, baseUrl: this.config.baseUrl, stopped, preview });
        if (!message) return;
        await tx.execute(sql`
            UPDATE email_replies
            SET alert_status = ${status.status}, alert_next_at = ${status.status === "pending" ? this.now.toISOString() : null}::timestamptz,
                alert_message = ${message}, alert_last_error = ${status.lastError}
            WHERE id = ${replyId}::int
        `);
    }

    /** 반송·스팸 신고: SND recordBounceSignal (on이면 적용). SND 표가 아직 없으면 장부 줄만 남긴다 */
    private async handleBounce(tx: DbTx, replyId: number, p: ParsedMessage, d: MatchDecision, on: boolean): Promise<void> {
        const complaint = p.classification.kind === "system";
        const recipients = complaint
            ? [{ finalRecipient: p.feedbackRecipient, originalRecipient: null, action: null, status: null, diagnostic: null }]
            : p.dsnRecipients;
        // 반송 안내 부분이 없는 반송(네이버식 안내 등)은 SND에 넘길 받는 사람이 없다 — 장부 줄만 (bounce_type unknown, R14)
        if (recipients.length === 0) return;
        if (on && !(await claimReplyEffects(tx, replyId, p.classification.kind, "first"))) return;
        try {
            const result = await tx.transaction(async (sp) =>
                recordBounceForReply(sp, {
                    orgIds: d.orgId ? [d.orgId] : p.ownership.orgIds,
                    gmailMessageId: p.gmailId,
                    receivedAt: p.receivedAt,
                    toAddress: p.ownership.address,
                    threadLogId: d.log?.id ?? null,
                    signal: complaint ? "complaint" : "dsn",
                    apply: on,
                    recipients,
                    allowedWorkspaceIds: this.config.workspaceIds,
                })
            );
            if (result.outcomes.length > 0 && result.outcomes.every((o) => o.outOfScope)) {
                // 대체 짝짓기로 이은 발송이 허용 워크스페이스 밖 — 원본 머리글로 이었을 때(R59)처럼 장부 줄도 남기지 않는다 (RH-SEC-6·F8).
                // 효과 차지도 이 줄과 함께 지워진다. 같은 메일을 다시 읽어도 같은 판정이다
                await tx.execute(sql`DELETE FROM email_replies WHERE id = ${replyId}::int`);
                this.counts.stored--;
                if (d.status === "ambiguous") this.counts.ambiguous--;
                else if (d.status === "matched") this.counts.matched--;
                else this.counts.unmatched--;
                this.counts.outOfScope++;
                return;
            }
            const outcomes = result.outcomes.filter((o) => !o.outOfScope);
            const first = outcomes.find((o) => o.sendLogId !== null) ?? outcomes[0] ?? null;
            this.counts.bounceSignals += outcomes.filter((o) => !o.duplicate).length;
            let workspaceId = d.workspaceId;
            let recordId = d.log?.record_id ?? null;
            let matchedRecipient: string | null = d.log ? normalizeReplyAddress(d.log.recipient_email) : null;
            if (!d.log && first?.sendLogId) {
                // SND 대체 짝짓기(7일)로 이어졌다 — 장부 줄에도 그 발송을 적는다
                const linked = rows<{ workspace_id: number | null; record_id: number | null; recipient_email: string; org_id: string }>(
                    await tx.execute(sql`
                        SELECT p.workspace_id, r.id AS record_id, l.recipient_email, l.org_id
                        FROM email_send_logs l
                        LEFT JOIN partitions p ON p.id = l.partition_id
                        LEFT JOIN records r ON r.id = l.record_id AND r.org_id = l.org_id
                        WHERE l.id = ${first.sendLogId}::int
                    `)
                )[0];
                if (linked) {
                    workspaceId = linked.workspace_id;
                    recordId = linked.record_id;
                    matchedRecipient = normalizeReplyAddress(linked.recipient_email);
                    // 규칙·단계도 사슬 첫 메일에서 찾는다 — 원본 머리글로 이은 줄과 같게 (R47, OPS-10)
                    const chain = (await this.loadChains([first.sendLogId], tx)).get(first.sendLogId) ?? null;
                    await tx.execute(sql`
                        UPDATE email_replies
                        SET send_log_id = ${first.sendLogId}::int, org_id = ${linked.org_id}::uuid, workspace_id = ${workspaceId}::int,
                            record_id = ${recordId}::int, matched_recipient = ${clip(matchedRecipient, 200)},
                            root_log_id = ${chain?.rootId ?? null}::int, rule_kind = ${chain?.ruleKind ?? null},
                            rule_id = ${chain?.ruleId ?? null}::int, step_index = ${chain?.depth ?? null}::int,
                            match_status = 'matched', match_method = 'dsn_fallback'
                        WHERE id = ${replyId}::int
                    `);
                    this.counts.unmatched--;
                    this.counts.matched++;
                }
            }
            await tx.execute(sql`
                UPDATE email_replies
                SET bounce_type = COALESCE(${first && first.kind !== "complaint" ? first.kind : null}, bounce_type),
                    effects = ${JSON.stringify({
                        preview: !on,
                        bounceSignals: outcomes.filter((o) => !o.duplicate).length,
                        logMarkedFailed: outcomes.filter((o) => o.counted).length,
                        recordEvents: result.recordEvents,
                    })}::jsonb
                WHERE id = ${replyId}::int
            `);
        } catch (e) {
            const pg = pgErrorOf(e);
            if (pg && (pg.code === "42P01" || pg.code === "42703")) {
                // SND 표(0075)가 아직 없다 — 장부 줄만 남기고 신호는 SND 배포 뒤 (효과 차지를 되돌려 밀린 효과가 다시 본다)
                await tx.execute(sql`
                    UPDATE email_replies SET effects_applied_at = NULL, effects_applied_kind = NULL,
                        effects = ${JSON.stringify({ bounceSignalSkipped: "snd_tables_missing" })}::jsonb
                    WHERE id = ${replyId}::int
                `);
                return;
            }
            throw e;
        }
    }

    // ── 밀린 효과 (7-1) ──

    /**
     * on 회차 첫머리: 14일 안 이어진 사람 회신·반송 중 효과가 없는 줄에 적용한다 (dry_run → on, 효과 단계의 일시 오류).
     * 카드는 on으로 처음 저장된 줄이고 도착 24시간 안일 때만 (m1). dry_run으로 저장된 줄은 카드 없음 (R31)
     */
    private async applyPendingEffects(): Promise<void> {
        const since = new Date(this.now.getTime() - PENDING_EFFECTS_DAYS * DAY_MS).toISOString();
        const pending = rows<{
            id: number;
            kind: string;
            org_id: string;
            workspace_id: number;
            record_id: number | null;
            send_log_id: number | null;
            root_log_id: number | null;
            rule_kind: string | null;
            rule_id: number | null;
            step_index: number | null;
            contact_email: string;
            matched_recipient: string | null;
            received_at: string | Date;
            detected_mode: string;
            from_name: string | null;
            from_email: string;
            to_email: string;
            subject: string | null;
            excerpt: string | null;
            unsubscribe_hint: boolean;
            workspace_guessed: boolean;
            match_status: string;
        }>(
            await db.execute(sql`
                SELECT id, kind, org_id, workspace_id, record_id, send_log_id, root_log_id, rule_kind, rule_id, step_index,
                       contact_email, matched_recipient, received_at, detected_mode, from_name, from_email, to_email, subject,
                       excerpt, unsubscribe_hint, workspace_guessed, match_status
                FROM email_replies
                WHERE effects_applied_at IS NULL AND match_status = 'matched' AND kind IN ('human','bounce')
                  AND received_at > ${since}::timestamptz AND process_error IS NULL AND org_id IS NOT NULL
                  AND workspace_id = ANY(${sql.param(this.config.workspaceIds)}::int[])
                ORDER BY received_at ASC, id ASC
                LIMIT ${PENDING_EFFECTS_BATCH}
            `)
        );
        const bounceRows = pending.filter((r) => r.kind === "bounce");
        for (const r of pending.filter((x) => x.kind === "human")) {
            if (this.overBudget()) return;
            const receivedAt = toDate(r.received_at) ?? this.now;
            await db.transaction(async (tx) => {
                if (!(await claimReplyEffects(tx, r.id, "human", "first"))) return;
                this.counts.pendingEffectsApplied++;
                const res = await stopAutomationForReply(
                    tx,
                    {
                        id: r.id,
                        kind: "human",
                        matchStatus: "matched",
                        orgId: r.org_id,
                        workspaceId: r.workspace_id,
                        recordId: r.record_id,
                        contactEmail: r.contact_email,
                        matchedRecipient: r.matched_recipient,
                        receivedAt,
                        sendLogId: r.send_log_id,
                        ruleKind: r.rule_kind,
                        ruleId: r.rule_id,
                        stepIndex: r.step_index,
                    },
                    { dryRun: false }
                );
                await tx.execute(sql`
                    UPDATE email_replies SET effects = ${JSON.stringify({
                        followupsCancelled: res.followups,
                        automationCancelled: res.automation,
                        sendQueueSkipped: res.sendQueue,
                        recordEventId: res.recordEventId,
                        pendingApplied: true,
                    })}::jsonb WHERE id = ${r.id}::int
                `);
                // on으로 처음 저장된 줄(효과 단계 일시 오류)만 카드 — dry_run 줄은 카드 없음
                if (r.detected_mode === "on") {
                    const target = replyAlertTarget({
                        kind: "human",
                        matchStatus: r.match_status,
                        workspaceId: r.workspace_id,
                        workspaceGuessed: r.workspace_guessed,
                        allowedWorkspaceIds: this.config.workspaceIds,
                    });
                    const status = replyAlertStatus({
                        syncMode: "on",
                        alertMode: this.config.alertMode,
                        receivedAt,
                        now: this.now,
                        lastSuccessAt: toDate(this.state.last_success_at),
                    });
                    if (target && status) {
                        const message = await buildAlertMessageFor(
                            tx,
                            {
                                id: r.id,
                                orgId: r.org_id,
                                workspaceId: r.workspace_id,
                                recordId: r.record_id,
                                sendLogId: r.send_log_id,
                                rootLogId: r.root_log_id,
                                ruleKind: r.rule_kind,
                                ruleId: r.rule_id,
                                stepIndex: r.step_index,
                                fromName: r.from_name,
                                fromEmail: r.from_email,
                                toEmail: r.to_email,
                                subject: r.subject,
                                excerpt: r.excerpt,
                                receivedAt,
                                unsubscribeHint: r.unsubscribe_hint,
                            },
                            target,
                            { now: this.now, baseUrl: this.config.baseUrl, stopped: res, preview: false }
                        );
                        if (message) {
                            await tx.execute(sql`
                                UPDATE email_replies
                                SET alert_status = ${status.status},
                                    alert_next_at = ${status.status === "pending" ? this.now.toISOString() : null}::timestamptz,
                                    alert_message = ${message}, alert_last_error = ${status.lastError}
                                WHERE id = ${r.id}::int AND (alert_status IS NULL OR alert_status = 'dry_run')
                            `);
                        }
                    }
                }
            });
        }

        if (bounceRows.length > 0 && !this.overBudget()) {
            const orgIds = [...new Set(bounceRows.map((r) => r.org_id))];
            try {
                await db.transaction(async (tx) => {
                    const res = await applyPendingBouncesForReplies(tx, orgIds, new Date(this.now.getTime() - PENDING_EFFECTS_DAYS * DAY_MS));
                    await tx.execute(sql`
                        UPDATE email_replies
                        SET effects_applied_at = now(), effects_applied_kind = 'bounce',
                            effects = COALESCE(effects, '{}'::jsonb) || ${JSON.stringify({ pendingApplied: true, pendingSignalsApplied: res.outcomes.length, recordEvents: res.recordEvents })}::jsonb
                        WHERE id = ANY(${sql.param(bounceRows.map((r) => r.id))}::int[]) AND effects_applied_at IS NULL
                    `);
                    this.counts.pendingEffectsApplied += bounceRows.length;
                    this.counts.bounceSignals += res.outcomes.length;
                });
            } catch (e) {
                const pg = pgErrorOf(e);
                if (pg && (pg.code === "42P01" || pg.code === "42703")) {
                    console.warn("[reply-sync] 반송 신호 표(SND 0075)가 없어 밀린 반송 효과를 건너뜀");
                } else {
                    throw e;
                }
            }
        }
    }

    // ── 알림 보내기 (8절) ──

    private async reclaimStuckAlerts(): Promise<number> {
        const r = rows<{ id: number }>(
            await db.execute(sql`
                UPDATE email_replies
                SET alert_status = CASE WHEN alert_attempts < ${MAX_ATTEMPTS} THEN 'pending' ELSE 'failed' END,
                    alert_locked_at = NULL, alert_last_error = ${STUCK_ALERT_ERROR}
                WHERE alert_status = 'processing'
                  AND alert_locked_at < now() - (${ALERT_STUCK_MS}::bigint * INTERVAL '1 millisecond')
                RETURNING id
            `)
        );
        return r.length;
    }

    /** 깊이 알림의 deliverClaimedBatch를 그대로 쓴다 — 1.1초 간격, 429·5xx 10분 뒤 3번, 401·403·404 되돌림, 24시간 지나면 닫음 */
    private async deliverAlerts(): Promise<void> {
        const startedAt = Date.now();
        // 회차 예산(4분)과 보내기 예산(60초). 읽기는 READ_BUDGET_MS에서 멈추므로 이 60초는 늘 남는다 (RC-14)
        const overBudget = () => Date.now() - this.startedAt > RUN_BUDGET_MS || Date.now() - startedAt > ALERT_DELIVERY_BUDGET_MS;
        const ws = sql.param(this.config.workspaceIds);
        const staleBefore = new Date(this.now.getTime() - STALE_AFTER_MS).toISOString();
        // 묵은 줄을 닫을 때 원인(웹훅 404 등)을 지우지 않고 뒤에 남긴다 (WPN-6)
        const expired = rows<{ id: number }>(
            await db.execute(sql`
                UPDATE email_replies
                SET alert_status = 'skipped', alert_locked_at = NULL,
                    alert_last_error = ${STALE_ALERT_ERROR}::text || COALESCE(' — 직전: ' || left(alert_last_error, 300), '')
                WHERE alert_status = 'pending' AND alert_next_at < ${staleBefore}::timestamptz AND workspace_id = ANY(${ws}::int[])
                RETURNING id
            `)
        );
        this.stats.alerts.expired += expired.length;

        const release = async (ids: number[], lastError?: string) => {
            if (ids.length === 0) return;
            await db.execute(sql`
                UPDATE email_replies
                SET alert_status = 'pending', alert_locked_at = NULL, alert_attempts = GREATEST(alert_attempts - 1, 0)
                    ${lastError !== undefined ? sql`, alert_last_error = ${lastError}` : sql``}
                WHERE id = ANY(${sql.param(ids)}::int[]) AND alert_status = 'processing'
            `);
        };
        const threads = chatThreadsEnabled(this.env);
        const sourceOf = new Map(this.config.webhookChecks.map((c) => [c.workspaceId, c.source]));
        const orgOf = new Map<number, string>();
        const deps: DeliveryDeps = {
            now: this.now,
            overBudget,
            webhookFor: (workspaceId) => this.config.webhookByWorkspace[workspaceId],
            post: async (url, text, row) => {
                // 같은 고객(레코드)의 연속 회신은 한 스레드로 (GOOGLE_CHAT_THREADS=on, RC-9)
                const org = row ? (orgOf.get(row.id) ?? "").slice(0, 8) : "";
                const threadKey = threads && row ? (row.recordId !== null ? `reply-${org}-r${row.recordId}` : `reply-${org}-u${row.id}`) : undefined;
                try {
                    return await postGoogleChatText(url, text, fetch, {
                        threadKey,
                        requestId: row ? chatRequestIdFor(this.env, "reply", row.id) : undefined,
                    });
                } catch (e) {
                    return { ok: false, status: null, error: e instanceof Error ? e.message : String(e), retryable: true };
                }
            },
            // 기한 줄은 보내는 때 기준으로 다시 쓴다 — 늦게 나간 카드에 지난 기한이 가지 않게 (RC-12)
            prepareText: (row) => refreshReplyCardForSend(row.message, this.now),
            onResult: (row, result) => recordChatWebhookResult(sourceOf.get(row.workspaceId), row.workspaceId, result, this.config.webhookByWorkspace[row.workspaceId]),
            idempotent: chatRequestIdEnabled(this.env),
            markSent: async (id) => {
                await db.execute(sql`
                    UPDATE email_replies SET alert_status = 'sent', alert_sent_at = now(), alert_last_error = NULL, alert_locked_at = NULL
                    WHERE id = ${id}::int
                `);
            },
            markSkipped: async (id, reason) => {
                await db.execute(sql`
                    UPDATE email_replies SET alert_status = 'skipped', alert_last_error = ${reason.slice(0, 500)}, alert_locked_at = NULL
                    WHERE id = ${id}::int
                `);
            },
            markFailed: async (id, error) => {
                await db.execute(sql`
                    UPDATE email_replies SET alert_status = 'failed', alert_last_error = ${error}, alert_locked_at = NULL WHERE id = ${id}::int
                `);
            },
            requeue: async (id, error, at) => {
                await db.execute(sql`
                    UPDATE email_replies SET alert_status = 'pending', alert_last_error = ${error}, alert_locked_at = NULL,
                        alert_next_at = ${at.toISOString()}::timestamptz
                    WHERE id = ${id}::int
                `);
            },
            release,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            log: (message) => console.log(message),
            logPrefix: "[reply-alert]",
        };

        const state = { posted: 0 };
        const broken = new Set<number>();
        while (!overBudget()) {
            const wsIds = this.config.workspaceIds.filter((id) => !broken.has(id));
            if (wsIds.length === 0) break;
            const batch = rows<{ id: number; org_id: string; workspace_id: number; record_id: number | null; alert_message: string; alert_attempts: number }>(
                await db.execute(sql`
                    UPDATE email_replies
                    SET alert_status = 'processing', alert_locked_at = now(), alert_attempts = alert_attempts + 1
                    WHERE id IN (
                        SELECT id FROM email_replies
                        WHERE alert_status = 'pending'
                          AND alert_next_at <= ${this.now.toISOString()}::timestamptz
                          AND alert_next_at >= ${staleBefore}::timestamptz
                          AND workspace_id = ANY(${sql.param(wsIds)}::int[])
                          AND alert_message IS NOT NULL
                        ORDER BY alert_next_at ASC, id ASC
                        LIMIT ${ALERT_BATCH}
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, org_id, workspace_id, record_id, alert_message, alert_attempts
                `)
            ).sort((a, b) => a.id - b.id);
            for (const r of batch) orgOf.set(r.id, String(r.org_id ?? ""));
            if (batch.length === 0) break;
            const claimed: ClaimedAlert[] = batch.map((r) => ({
                id: r.id,
                workspaceId: r.workspace_id,
                recordId: r.record_id,
                message: r.alert_message,
                attempts: r.alert_attempts,
            }));
            const tally = await deliverClaimedBatch(claimed, new Map(), deps, state);
            this.stats.alerts.sent += tally.sent;
            this.stats.alerts.failed += tally.failed;
            this.stats.alerts.requeued += tally.requeued;
            this.stats.alerts.skipped += tally.skipped;
            this.stats.alerts.deferred += tally.deferred;
            for (const id of [...tally.brokenWorkspaces, ...tally.stalledWorkspaces]) broken.add(id);
            if (tally.budgetHit) break;
        }
    }
}

// ============================================
// 운영 알림 보내기 (회차·읽기 막힘이 함께 쓴다)
// ============================================

/** 설정 오류(401·403·404·형식)로 고장 난 운영 웹훅은 1시간에 한 번만 다시 해 본다 — 5분마다 죽은 웹훅으로 보내지 않게 (RO-4) */
const OPS_BROKEN_RETRY_MS = 60 * 60 * 1000;
/** 운영 알림 글을 구글이 받지 않으면(400) 같은 받는 곳은 1시간 뒤에 다시 — 회차마다 같은 글을 다시 보내지 않게 (RO-4) */
const opsRejectedAt = new Map<string, number>();

/**
 * 운영 알림 한 통. 받는 곳 이름과 결과만 로그에 남긴다 (주소는 비밀값). 결과는 웹훅 상태 표에 남는다 — 회신 탭 띠·발송 건강 화면·
 * 다른 운영 후보로의 웹훅 문제 알림이 이것을 본다 (RO-4·WPN-3)
 */
async function postReplyOps(config: ReplyConfig, env: Env, text: string): Promise<"sent" | "uncertain" | "failed"> {
    const hook = config.opsWebhook;
    if (!hook) return "failed";
    const broken = await chatWebhookBroken(hook.source, hook.url);
    if (broken && broken.kind !== "unreachable" && broken.lastFailAt && Date.now() - broken.lastFailAt.getTime() < OPS_BROKEN_RETRY_MS) {
        console.warn(`[reply-sync] 운영 알림 받는 곳 ${hook.source}가 고장 (${broken.kind}) — 1시간 뒤 다시 해 봄`);
        return "failed";
    }
    const rejectKey = `${hook.source}|${webhookFingerprint(hook.url) ?? ""}`;
    const rejectedAt = opsRejectedAt.get(rejectKey);
    if (rejectedAt !== undefined && Date.now() - rejectedAt < OPS_BROKEN_RETRY_MS) {
        console.warn(`[reply-sync] 운영 알림 글을 구글 챗이 받지 않았음 (${hook.source}, 400) — 1시간 뒤 다시 해 봄`);
        return "failed";
    }
    let result: GoogleChatResult;
    try {
        result = await postGoogleChatText(hook.url, text, fetch, {
            threadKey: chatThreadsEnabled(env) ? `reply-ops-${hashMailbox(config.mailbox)}` : undefined,
        });
    } catch (e) {
        result = { ok: false, status: null, error: e instanceof Error ? e.message : String(e), retryable: false };
    }
    await recordChatWebhookResult(hook.source, null, result, hook.url);
    if (!result.ok && result.status === 400) opsRejectedAt.set(rejectKey, Date.now());
    else opsRejectedAt.delete(rejectKey);
    if (result.ok) {
        console.log(`[reply-sync] 운영 알림 보냄 (${hook.source})`);
        return "sent";
    }
    console.warn(`[reply-sync] 운영 알림 실패 (${hook.source}) status=${result.status ?? "-"}: ${result.error.slice(0, 200)}`);
    return result.uncertain ? "uncertain" : "failed";
}

function hashMailbox(mailbox: string): string {
    let h = 0;
    for (const ch of mailbox) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h.toString(36);
}

/**
 * 운영 서버인데 REPLY_PRIVATE_DOMAINS가 비어 메일함을 읽지 않는다 (RO-13): 상태 줄에 오류로 남겨 운영 스페이스에 6시간에 한 번 알리고,
 * 고쳐지면 다음 성공 회차가 회복 글을 보낸다. 잠금 없이 해도 된다 (조건부 UPDATE 하나로 한 번만 보낸다)
 */
async function recordReadBlocked(config: ReplyConfig, env: Env): Promise<void> {
    await db.execute(sql`INSERT INTO email_reply_mailbox_state (mailbox) VALUES (${config.mailbox}) ON CONFLICT (mailbox) DO NOTHING`);
    const text = replyErrorText("read_blocked");
    const claimed = rows<{ prev: string | Date | null; ops_alerted_at: string | Date | null }>(
        await db.execute(sql`
            WITH prev AS (SELECT ops_alerted_at AS prev FROM email_reply_mailbox_state WHERE mailbox = ${config.mailbox})
            UPDATE email_reply_mailbox_state
            SET last_run_at = now(), last_error_code = 'read_blocked', last_error = ${text},
                last_error_at = COALESCE(CASE WHEN last_error_code = 'read_blocked' THEN last_error_at END, now()),
                ops_alerted_at = CASE WHEN ${config.opsWebhook !== null}::boolean
                                       AND (ops_alerted_at IS NULL OR ops_alerted_code IS DISTINCT FROM 'read_blocked'
                                            OR ops_alerted_at < now() - (${OPS_ALERT_INTERVAL_MS}::bigint * INTERVAL '1 millisecond'))
                                      THEN now() ELSE ops_alerted_at END,
                ops_alerted_code = CASE WHEN ${config.opsWebhook !== null}::boolean THEN 'read_blocked' ELSE ops_alerted_code END,
                updated_at = now()
            WHERE mailbox = ${config.mailbox}
            RETURNING (SELECT prev FROM prev) AS prev, ops_alerted_at
        `)
    );
    const r = claimed[0];
    if (!r || !config.opsWebhook) return;
    const at = toDate(r.ops_alerted_at);
    const prev = toDate(r.prev);
    if (!at || (prev && at.getTime() === prev.getTime())) return;
    const message = buildOpsAlertMessage("read_blocked", null, {
        syncMode: config.syncMode,
        serverLabel: replyServerLabel(config),
        baseUrl: config.baseUrl,
    });
    const sent = await postReplyOps(config, env, message);
    if (sent === "failed") {
        await db.execute(sql`
            UPDATE email_reply_mailbox_state SET ops_alerted_at = ${prev ? prev.toISOString() : null}::timestamptz WHERE mailbox = ${config.mailbox}
        `);
    }
}

// ============================================
// 화면·매일 보고용 상태 (읽기만)
// ============================================

export interface ReplySyncStatus {
    mode: ReplySyncMode;
    requestedMode: ReplySyncMode;
    alertMode: ReplyAlertMode;
    serverKind: ReplyServerKind;
    configured: boolean;
    /** 가린 메일함 주소 */
    mailboxMasked: string;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    errorCode: string | null;
    /** 한국어 한 줄 (주소·비밀값 없음) */
    errorText: string | null;
    errorSince: string | null;
    backfillDone: boolean;
    /** 뺀 주소 (가린 모양, B1) */
    excluded: string[];
    /** 설정 경고 (한국어) */
    warnings: string[];
    tableMissing?: boolean;
}

/** 회신 탭 띠 (GET /api/email/replies meta.sync)·SND 매일 보고가 읽는다 */
export async function loadReplySyncStatus(env: Env = process.env): Promise<ReplySyncStatus> {
    const config = resolveReplyConfig(env);
    const base: ReplySyncStatus = {
        mode: config.syncMode,
        requestedMode: config.requestedSyncMode,
        alertMode: config.alertMode,
        serverKind: config.serverKind,
        configured: config.credentials !== null,
        mailboxMasked: maskEmail(config.mailbox),
        lastRunAt: null,
        lastSuccessAt: null,
        errorCode: null,
        errorText: null,
        errorSince: null,
        backfillDone: false,
        excluded: [],
        warnings: config.warnings.map((w) => w.text),
    };
    // 운영 알림 받는 곳이 고장이면 띠에 보인다 — 알림이 끊긴 줄 모르는 일이 없게 (RO-4)
    if (config.opsWebhook) {
        const broken = await chatWebhookBroken(config.opsWebhook.source, config.opsWebhook.url);
        if (broken) {
            base.warnings.push(
                `운영 알림을 보내지 못하고 있습니다 (${config.opsWebhook.source}, ${broken.kind === "unreachable" ? "연결 실패" : "웹훅 설정 오류"}) — 웹훅 주소를 확인해 주세요`
            );
        }
    }
    try {
        const r = rows<{
            last_run_at: string | Date | null;
            last_success_at: string | Date | null;
            last_error_code: string | null;
            last_error: string | null;
            last_error_at: string | Date | null;
            backfill_done_at: string | Date | null;
            stats: Record<string, unknown> | null;
        }>(
            await db.execute(sql`
                SELECT last_run_at, last_success_at, last_error_code, last_error, last_error_at, backfill_done_at, stats
                FROM email_reply_mailbox_state WHERE mailbox = ${config.mailbox}
            `)
        )[0];
        if (!r) return base;
        const iso = (v: string | Date | null) => toDate(v)?.toISOString() ?? null;
        const excluded = Array.isArray(r.stats?.excluded) ? (r.stats!.excluded as unknown[]).filter((x): x is string => typeof x === "string") : [];
        return {
            ...base,
            lastRunAt: iso(r.last_run_at),
            lastSuccessAt: iso(r.last_success_at),
            errorCode: r.last_error_code,
            errorText: r.last_error ?? (r.last_error_code ? replyErrorText(r.last_error_code) : null),
            errorSince: iso(r.last_error_at),
            backfillDone: r.backfill_done_at !== null,
            excluded,
        };
    } catch (e) {
        if (pgErrorOf(e)?.code === "42P01") return { ...base, tableMissing: true };
        throw e;
    }
}
