/**
 * 보내기 직전 막기 (DESIGN-RPL 7-4): "이 사업에서 이 주소가 회신했나 · 이 조직에서 이 주소가 hard 반송됐나".
 *
 * 대기열 멈춤(7-2)은 그때 있던 줄만 멈춘다. 처리 중이던 줄, 나중에 생긴 줄(다른 파티션의 같은 사람, 반복 재등록,
 * enqueueDeferredSend가 되살린 줄)도 막으려고 자동 메일 경로가 보내기 전에 한 번 더 본다 (수신거부 확인 바로 뒤).
 *   - REPLY_SYNC_MODE가 on이 아니면 늘 null — dry_run에서는 고객 메일이 바뀌지 않는다
 *   - 사람 회신은 사업(워크스페이스) 단위: 보낸 사람 또는 원래 받은 사람(M3), 막기 켜짐, 90일 안 (수신거부 말이면 기한 없음)
 *   - 반송은 조직 단위 (B2): SND email_bounce_signals의 hard·받는 사람 같음·적용됨, 90일 안. 막기 목록 갈래(PRD SND-2, F2)는
 *     bounceBlockSignal — 발신 쪽 실패(5.7.x·인증·정책)는 막지 않고, 주소 없음(5.1.x 등)은 바로, 메일함 가득 같은 일시 문제는 3번 쌓일 때만
 *   - 표가 없으면(42P01) 막지 않는다 — 마이그레이션이 실패해도 발송이 멈추지 않게
 * 수동 발송은 막지 않는다 (사람이 고른 일).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bounceBlockSignal } from "@/lib/email-status-sync-rules";
import {
    BLOCK_DAYS,
    addressVariants,
    describeReplyError,
    normalizeReplyAddress,
    pgErrorOf,
    resolveReplyConfig,
} from "@/lib/email-reply-rules";

export type ReplyStopReason = "replied" | "bounced";

export interface ReplyStop {
    reason: ReplyStopReason;
    replyId?: number;
    signalId?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

let warnedMissing = false;

/** 표·칸이 없으면(마이그레이션 전) 막지 않는다 */
function isMissingRelation(e: unknown): boolean {
    const code = pgErrorOf(e)?.code;
    return code === "42P01" || code === "42703";
}

function warnMissingOnce(e: unknown): void {
    if (warnedMissing) return;
    warnedMissing = true;
    console.warn(`[reply-guard] 회신·반송 표가 없어 막지 않음 (마이그레이션 확인 필요): ${describeReplyError(e)}`);
}

function guardActive(env: Record<string, string | undefined>): boolean {
    return resolveReplyConfig(env).syncMode === "on";
}

/** 회신 줄의 contact_email·matched_recipient는 정규화 값(+태그 뗌)으로 저장된다 — 같은 모양으로 비교한다 */
function keyOf(email: string): string {
    return normalizeReplyAddress(email);
}

/**
 * 받는 주소들 중 막힌 것 (입력 주소 그대로 → 막힘). 회신이 먼저다 (둘 다 맞으면 회신).
 * 대기열 미리 판정(walkQueueRow)과 실제 발송 경로가 같은 조건을 써야 하므로 findReplyStop도 이 함수를 부른다.
 */
export async function loadReplyStops(
    orgId: string,
    workspaceId: number | null,
    emails: readonly string[],
    now: Date = new Date(),
    env: Record<string, string | undefined> = process.env
): Promise<Map<string, ReplyStop>> {
    const out = new Map<string, ReplyStop>();
    const valid = emails.filter((e) => typeof e === "string" && e.includes("@"));
    if (valid.length === 0 || !guardActive(env)) return out;

    const since = new Date(now.getTime() - BLOCK_DAYS * DAY_MS).toISOString();
    const norms = [...new Set(valid.map(keyOf))];

    // 사람 회신 (사업 단위) — 색인 er_stop_idx·er_stop_recipient_idx
    const repliedBy = new Map<string, number>();
    if (workspaceId !== null) {
        try {
            const rows = (await db.execute(sql`
                SELECT id, contact_email, matched_recipient
                FROM email_replies
                WHERE workspace_id = ${workspaceId}::int
                  AND org_id = ${orgId}::uuid
                  AND (contact_email = ANY(${sql.param(norms)}::text[]) OR matched_recipient = ANY(${sql.param(norms)}::text[]))
                  AND stop_automation
                  AND kind = 'human'
                  AND (unsubscribe_hint OR received_at > ${since}::timestamptz)
                ORDER BY received_at DESC
            `)) as unknown as Array<{ id: number; contact_email: string; matched_recipient: string | null }>;
            for (const r of rows) {
                for (const k of [r.contact_email, r.matched_recipient]) {
                    if (k && !repliedBy.has(k)) repliedBy.set(k, r.id);
                }
            }
        } catch (e) {
            if (!isMissingRelation(e)) throw e;
            warnMissingOnce(e);
        }
    }
    for (const email of valid) {
        const replyId = repliedBy.get(keyOf(email));
        if (replyId !== undefined) out.set(email, { reason: "replied", replyId });
    }

    // hard 반송 (조직 단위, SND 신호 표) — 색인 ebs_org_recipient_idx
    const rest = valid.filter((e) => !out.has(e));
    if (rest.length === 0) return out;
    const variants = [...new Set(rest.flatMap((e) => addressVariants(e)))];
    try {
        const rows = (await db.execute(sql`
            SELECT id, recipient_email, dsn_status, diagnostic, fail_side, gmail_message_id
            FROM email_bounce_signals
            WHERE org_id = ${orgId}::uuid
              AND recipient_email = ANY(${sql.param(variants)}::text[])
              AND kind = 'hard'
              AND recipient_match = 'same'
              AND applied_at IS NOT NULL
              AND received_at > ${since}::timestamptz
            ORDER BY received_at DESC
        `)) as unknown as Array<{
            id: number;
            recipient_email: string;
            dsn_status: string | null;
            diagnostic: string | null;
            fail_side: string | null;
            gmail_message_id: string;
        }>;
        type SignalLite = Parameters<typeof bounceBlockSignal>[0][number];
        const signalsBy = new Map<string, SignalLite[]>();
        for (const r of rows) {
            const lite: SignalLite = { id: r.id, status: r.dsn_status, diagnostic: r.diagnostic, failSide: r.fail_side, messageKey: r.gmail_message_id };
            for (const k of addressVariants(r.recipient_email)) {
                const list = signalsBy.get(k) ?? signalsBy.set(k, []).get(k)!;
                if (!list.some((x) => x.id === lite.id)) list.push(lite);
            }
        }
        for (const email of rest) {
            const signals = new Map<number, SignalLite>();
            for (const v of addressVariants(email)) for (const sgl of signalsBy.get(v) ?? []) signals.set(sgl.id, sgl);
            const hit = bounceBlockSignal([...signals.values()].sort((a, b) => b.id - a.id));
            if (hit !== null) out.set(email, { reason: "bounced", signalId: hit });
        }
    } catch (e) {
        if (!isMissingRelation(e)) throw e;
        warnMissingOnce(e);
    }
    return out;
}

/** 주소 하나 (7-4). 막히면 { reason, replyId | signalId }, 아니면 null */
export async function findReplyStop(
    orgId: string,
    workspaceId: number | null,
    email: string,
    now: Date = new Date(),
    env: Record<string, string | undefined> = process.env
): Promise<ReplyStop | null> {
    const stops = await loadReplyStops(orgId, workspaceId, [email], now, env);
    return stops.get(email) ?? null;
}

/** 대기열 last_error·로그에 남길 짧은 글 */
export function replyStopText(stop: ReplyStop): string {
    return stop.reason === "replied"
        ? `회신으로 멈춤 (회신 #${stop.replyId ?? "-"})`
        : `반송된 주소라 멈춤 (반송 신호 #${stop.signalId ?? "-"})`;
}
