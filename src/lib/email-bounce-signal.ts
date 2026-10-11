/**
 * 반송 안내(DSN)·스팸 신고 신호 — 발송 기록 쓰기는 여기 한 곳 (DESIGN-SND 4절 = DESIGN-RPL 7-3, B2·SND-01).
 *
 * 회신 읽기(RPL)는 반송 안내를 알아보고 풀고 원본 Message-ID로 발송을 찾아(threadLogId) 이 함수를 부를 뿐이다.
 * 대체 짝짓기(받는 주소·우리 주소·7일), 등급(classifyDsn), 받는 사람 같음 확인, email_send_logs 쓰기, 실패 한 번만 세기,
 * 중복 막기, 신호 표 email_bounce_signals는 여기서 한다.
 *
 * 이 파일은 DESIGN-SND 몫이다. 회신 읽기가 먼저 구현되면서 4-3 계약 그대로 먼저 두었다. 신호 표와 발송 기록의 배달 결과 칸은
 * 마이그레이션 0075(SND)가 만든다 — 그 전에는 표가 없어(42P01·42703) 부른 쪽(RPL)이 신호 없이 회신 장부 줄만 남긴다.
 * 던지지 않는다. DB 오류만 던진다 (RPL의 메일 하나 격리가 받는다).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DbExec } from "@/lib/db/tx";
import { EMAIL_TRIM_CHARS, normalizeEmail } from "@/lib/deep-visitor-alert-rules";
import { bounceBlockClass, classifyDsn, classifyFailSide, dsnLabel, type BounceBlockClass, type DsnKind } from "@/lib/email-status-sync-rules";

export interface BounceSignalInput {
    /** 받은 우리 주소의 조직들 (RPL 4-1 지도). 하나면 그 조직 */
    orgIds: string[];
    /** Gmail 메시지 번호 — 중복 막기 열쇠 */
    gmailMessageId: string;
    /** 메일함 도착 시각 (internalDate) */
    receivedAt: Date;
    /** 반송 안내를 받은 우리 발신 주소 (정규화) */
    toAddress: string;
    /** RPL이 원본 Message-ID(요청 번호)로 찾은 발송 기록 id. 있으면 이것을 먼저 쓴다 */
    threadLogId: number | null;
    /** complaint = 스팸 신고 (ARF feedback-report, RPL m7) */
    signal: "dsn" | "complaint";
    /** RPL이 on이면 true. false면 신호 줄만 남기고 발송 기록은 그대로 (applied_at NULL) */
    apply: boolean;
    /**
     * 회신 읽기가 처리하는 워크스페이스 (REPLY_WORKSPACE_IDS). 있으면 이어진 발송의 워크스페이스가 이 밖일 때 신호를 남기지 않고
     * outOfScope로 돌려준다 — 원본 머리글로 이은 반송(RPL이 저장하지 않음, R59)과 대체 짝짓기로 이은 반송이 같게 (RH-SEC-6·F8)
     */
    allowedWorkspaceIds?: readonly number[] | null;
    recipients: Array<{
        finalRecipient: string | null;
        originalRecipient: string | null;
        action: string | null;
        status: string | null;
        diagnostic: string | null;
    }>;
}

export type BounceSignalKind = DsnKind | "complaint";

export interface BounceSignalOutcome {
    signalId: number;
    sendLogId: number | null;
    recordId: number | null;
    kind: BounceSignalKind;
    /** null = 발송을 못 이음 */
    recipientMatch: "same" | "different" | null;
    applied: boolean;
    counted: boolean;
    duplicate: boolean;
    /** 막기 목록 갈래 (hard만, F2) — sender면 막지 않고 레코드 '반송' 사건도 남기지 않는다 */
    blockClass: BounceBlockClass | null;
    /** 이어진 발송이 허용 워크스페이스 밖 — 신호를 남기지 않았다 */
    outOfScope?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 대체 짝짓기 기간 하나 (4-4) */
export const BOUNCE_MATCH_DAYS = 7;

interface LogRow {
    id: number;
    org_id: string;
    record_id: number | null;
    recipient_email: string;
    workspace_id: number | null;
}

async function findThreadLog(exec: DbExec, orgIds: string[], logId: number): Promise<LogRow | null> {
    const rows = (await exec.execute(sql`
        SELECT l.id, l.org_id, r.id AS record_id, l.recipient_email, p.workspace_id
        FROM email_send_logs l
        LEFT JOIN records r ON r.id = l.record_id AND r.org_id = l.org_id
        LEFT JOIN partitions p ON p.id = l.partition_id
        WHERE l.id = ${logId}::int AND l.org_id = ANY(${sql.param(orgIds)}::uuid[])
    `)) as unknown as LogRow[];
    return rows[0] ?? null;
}

/** 4-4 대체: 받는 주소 = 반송된 주소, 우리 주소 = 보낸 주소, 7일. 두 조직에 걸치면 못 이음 */
async function findFallbackLog(exec: DbExec, orgIds: string[], recipient: string, toAddress: string, receivedAt: Date): Promise<LogRow | null> {
    const until = receivedAt.toISOString();
    const since = new Date(receivedAt.getTime() - BOUNCE_MATCH_DAYS * DAY_MS).toISOString();
    const rows = (await exec.execute(sql`
        SELECT l.id, l.org_id, r.id AS record_id, l.recipient_email, p.workspace_id
        FROM email_send_logs l
        LEFT JOIN records r ON r.id = l.record_id AND r.org_id = l.org_id
        LEFT JOIN partitions p ON p.id = l.partition_id
        LEFT JOIN email_sender_profiles sp ON sp.id = l.sender_profile_id AND sp.org_id = l.org_id
        WHERE l.org_id = ANY(${sql.param(orgIds)}::uuid[])
          AND l.sent_at <= ${until}::timestamptz AND l.sent_at >= ${since}::timestamptz
          AND lower(btrim(l.recipient_email, ${EMAIL_TRIM_CHARS}::text)) = ${recipient}
          AND lower(COALESCE(l.sender_email, sp.from_email, '')) = ${toAddress}
        ORDER BY l.sent_at DESC
        LIMIT 10
    `)) as unknown as LogRow[];
    if (rows.length === 0) return null;
    if (new Set(rows.map((r) => r.org_id)).size > 1) return null;
    return rows[0];
}

/**
 * 발송 기록을 실패로 (4-5 — 한 기록에 실패는 한 번만 센다). SST3(NHN 실패)·SST5·7·8은 상태를 덮지 않는다.
 * 돌려주는 값: 이 신호로 처음 실패가 됐나
 */
async function markLogFailed(
    exec: DbExec,
    logId: number,
    orgId: string,
    receivedAt: Date,
    status: string | null,
    diagnostic: string | null
): Promise<boolean> {
    const failSide = classifyFailSide(status, diagnostic);
    const rows = (await exec.execute(sql`
        WITH prev AS (
            SELECT id, delivery_fail_source AS prev_source
            FROM email_send_logs WHERE id = ${logId}::int AND org_id = ${orgId}::uuid FOR UPDATE
        )
        UPDATE email_send_logs l SET
            delivery_fail_source = COALESCE(l.delivery_fail_source, 'dsn'),
            delivery_failed_at   = COALESCE(l.delivery_failed_at, ${receivedAt.toISOString()}::timestamptz),
            delivery_status_code = COALESCE(l.delivery_status_code, ${status}),
            delivery_fail_side   = COALESCE(l.delivery_fail_side, ${failSide}),
            status               = CASE WHEN l.nhn_status_code IN ('SST5','SST7','SST8') THEN l.status ELSE 'failed' END,
            result_code          = CASE WHEN l.nhn_status_code = 'SST3' THEN l.result_code ELSE ${`DSN:${status ?? "?"}`.slice(0, 20)} END,
            result_message       = CASE WHEN l.nhn_status_code = 'SST3' THEN l.result_message ELSE ${`반송 안내: ${dsnLabel(status)}`} END
        FROM prev
        WHERE l.id = prev.id
        RETURNING (prev.prev_source IS NULL) AS counted
    `)) as unknown as Array<{ counted: boolean }>;
    return rows[0]?.counted === true;
}

function sameRecipient(a: string | null, b: string | null): boolean {
    return !!a && !!b && normalizeEmail(a) === normalizeEmail(b);
}

/**
 * 반송 안내 한 통(또는 스팸 신고 한 통)의 신호. 받는 사람마다 한 줄 (유일 키 (org_id, gmail_message_id, recipient_email)).
 * 발송 기록을 바꾸는 조건: apply AND kind IN (hard, expired) AND 받는 사람 같음 (M3 — 다르면 신호만, 실패율을 올리지 않게).
 * complaint는 발송 기록을 바꾸지 않는다 (매일 보고에 "스팸 신고 N통").
 */
export async function recordBounceSignal(input: BounceSignalInput, tx?: DbExec): Promise<BounceSignalOutcome[]> {
    const exec: DbExec = tx ?? db;
    const out: BounceSignalOutcome[] = [];
    if (input.orgIds.length === 0) return out;
    const toAddress = normalizeEmail(input.toAddress);
    const threadLog = input.threadLogId !== null ? await findThreadLog(exec, input.orgIds, input.threadLogId) : null;

    for (const r of input.recipients) {
        const kind: BounceSignalKind = input.signal === "complaint" ? "complaint" : classifyDsn(r.action, r.status);
        const bounced = normalizeEmail(r.finalRecipient ?? r.originalRecipient) || null;

        let log: LogRow | null = threadLog;
        if (!log && input.signal === "dsn" && bounced) {
            log = await findFallbackLog(exec, input.orgIds, bounced, toAddress, input.receivedAt);
        }
        if (log && input.allowedWorkspaceIds && (log.workspace_id === null || !input.allowedWorkspaceIds.includes(log.workspace_id))) {
            // 허용 워크스페이스 밖 발송 — 신호·발송 기록·사건을 남기지 않는다 (부른 쪽이 장부 줄도 지운다)
            out.push({
                signalId: 0,
                sendLogId: null,
                recordId: null,
                kind,
                recipientMatch: null,
                applied: false,
                counted: false,
                duplicate: false,
                blockClass: null,
                outOfScope: true,
            });
            continue;
        }
        const orgId = log?.org_id ?? (input.orgIds.length === 1 ? input.orgIds[0] : null);
        // 조직이 하나로 정해지지 않으면 줄을 남기지 않는다 (조직 섞임 막기 — RPL 회차 통계에만 센다)
        if (!orgId) continue;

        const recipientEmail = input.signal === "complaint" ? normalizeEmail(log?.recipient_email ?? bounced ?? "") : bounced ?? "";
        const recipientMatch: "same" | "different" | null = log
            ? input.signal === "complaint" || sameRecipient(bounced, log.recipient_email)
                ? "same"
                : "different"
            : null;

        const inserted = (await exec.execute(sql`
            INSERT INTO email_bounce_signals
                (org_id, send_log_id, record_id, recipient_email, original_recipient, sender_email,
                 dsn_action, dsn_status, diagnostic, kind, recipient_match, fail_side, gmail_message_id, received_at)
            VALUES (${orgId}::uuid, ${log?.id ?? null}, ${log?.record_id ?? null}, ${recipientEmail.slice(0, 200)},
                    ${normalizeEmail(r.originalRecipient) || null}, ${toAddress.slice(0, 200)},
                    ${r.action}, ${r.status}, ${r.diagnostic ? r.diagnostic.slice(0, 300) : null}, ${kind}, ${recipientMatch},
                    ${input.signal === "dsn" ? classifyFailSide(r.status, r.diagnostic) : null},
                    ${input.gmailMessageId}, ${input.receivedAt.toISOString()}::timestamptz)
            ON CONFLICT (org_id, gmail_message_id, recipient_email) DO NOTHING
            RETURNING id
        `)) as unknown as Array<{ id: number }>;

        if (inserted.length === 0) {
            const existing = (await exec.execute(sql`
                SELECT id, send_log_id, record_id, kind, recipient_match, applied_at IS NOT NULL AS applied, counted
                FROM email_bounce_signals
                WHERE org_id = ${orgId}::uuid AND gmail_message_id = ${input.gmailMessageId} AND recipient_email = ${recipientEmail.slice(0, 200)}
            `)) as unknown as Array<{ id: number; send_log_id: number | null; record_id: number | null; kind: BounceSignalKind; recipient_match: "same" | "different" | null; applied: boolean; counted: boolean }>;
            const e = existing[0];
            if (e) {
                out.push({
                    signalId: e.id,
                    sendLogId: e.send_log_id,
                    recordId: e.record_id,
                    kind: e.kind,
                    recipientMatch: e.recipient_match,
                    applied: e.applied,
                    counted: e.counted,
                    duplicate: true,
                    blockClass: e.kind === "hard" ? bounceBlockClass(r.status, r.diagnostic, null) : null,
                });
            }
            continue;
        }

        const signalId = inserted[0].id;
        let counted = false;
        if (input.apply) {
            if (log && (kind === "hard" || kind === "expired") && recipientMatch === "same") {
                counted = await markLogFailed(exec, log.id, log.org_id, input.receivedAt, r.status, r.diagnostic);
            }
            await exec.execute(sql`UPDATE email_bounce_signals SET applied_at = now(), counted = ${counted} WHERE id = ${signalId}::int`);
        }
        out.push({
            signalId,
            sendLogId: log?.id ?? null,
            recordId: log?.record_id ?? null,
            kind,
            recipientMatch,
            applied: input.apply,
            counted,
            duplicate: false,
            blockClass: kind === "hard" ? bounceBlockClass(r.status, r.diagnostic, input.signal === "dsn" ? classifyFailSide(r.status, r.diagnostic) : null) : null,
        });
    }
    return out;
}

/**
 * dry_run에서 남긴 신호(applied_at NULL)를 발송 기록에 적용한다 — RPL이 on으로 바뀐 첫 회차의 밀린 효과 (7-1).
 */
export async function applyPendingBounceSignals(orgIds: string[], since: Date, tx?: DbExec): Promise<BounceSignalOutcome[]> {
    const exec: DbExec = tx ?? db;
    if (orgIds.length === 0) return [];
    const rows = (await exec.execute(sql`
        SELECT s.id, s.org_id, s.send_log_id, r.id AS record_id, s.kind, s.recipient_match, s.dsn_status, s.diagnostic, s.fail_side, s.received_at
        FROM email_bounce_signals s
        LEFT JOIN records r ON r.id = s.record_id AND r.org_id = s.org_id
        WHERE s.org_id = ANY(${sql.param(orgIds)}::uuid[])
          AND s.applied_at IS NULL
          AND s.received_at >= ${since.toISOString()}::timestamptz
        ORDER BY s.received_at ASC, s.id ASC
        LIMIT 200
        FOR UPDATE OF s SKIP LOCKED
    `)) as unknown as Array<{
        id: number;
        org_id: string;
        send_log_id: number | null;
        record_id: number | null;
        kind: BounceSignalKind;
        recipient_match: "same" | "different" | null;
        dsn_status: string | null;
        diagnostic: string | null;
        fail_side: string | null;
        received_at: string | Date;
    }>;
    const out: BounceSignalOutcome[] = [];
    for (const s of rows) {
        let counted = false;
        if (s.send_log_id !== null && (s.kind === "hard" || s.kind === "expired") && s.recipient_match === "same") {
            counted = await markLogFailed(exec, s.send_log_id, s.org_id, new Date(s.received_at), s.dsn_status, s.diagnostic);
        }
        await exec.execute(sql`UPDATE email_bounce_signals SET applied_at = now(), counted = ${counted} WHERE id = ${s.id}::int`);
        out.push({
            signalId: s.id,
            sendLogId: s.send_log_id,
            recordId: s.record_id,
            kind: s.kind,
            recipientMatch: s.recipient_match,
            applied: true,
            counted,
            duplicate: false,
            blockClass: s.kind === "hard" ? bounceBlockClass(s.dsn_status, s.diagnostic, s.fail_side) : null,
        });
    }
    return out;
}
