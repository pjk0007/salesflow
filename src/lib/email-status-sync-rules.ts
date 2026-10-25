/**
 * 발송 결과 맞추기(SND-1) — 순수 규칙. DB를 모른다 (@/lib/db import 금지).
 * 설계: docs/2026-10-11-reply-and-health/DESIGN-SND.md 3절·4-3·13절.
 *
 * - classifyDsn: 반송 안내 등급. 회신 읽기(DESIGN-RPL)도 import한다 — RPL 장부 줄의 bounce_type과 SND 신호 표의 kind가
 *   다른 기준을 쓰지 않게 이 함수 하나로만 정한다 (B2·SND-01)
 * - mapNhnStatus: NHN 상태 코드 → 발송 기록에 쓸 값 (3-1 표). 커서·보조 질문·화면 버튼이 모두 이것을 지나 applyNhnStatuses로 쓴다
 * - classifyFailSide: 실패 쪽 (받는 쪽 / 우리 발신 쪽, SND-06)
 * - nextUpdateWindow·initialCursor·isCursorCaughtUp: update-mails 커서 창 (3-2·3-6)
 * - pairUpdatedMails·pairNhnRows: 결과 ↔ 발송 기록 짝짓기 (3-2·3-3)
 * - splitBudget: appKey 묶음마다 NHN 질문 예산 나누기 (3-4)
 * - formatNhnDateTime: KST "yyyy-MM-dd HH:mm:ss"
 */

export type DsnKind = "hard" | "expired" | "soft" | "unknown";

const DSN_STATUS_RE = /^\s*([245])\.\d{1,3}\.\d{1,3}\b/;

/**
 * 반송 안내(DSN) 수신자 한 묶음의 등급 (DESIGN-SND 4-3):
 *   failed + 5.x.x (또는 Action 없이 5.x.x) → hard     — 주소 없음 등 영구 실패
 *   failed + 4.x.x                         → expired  — 재시도 끝 (예 4.4.7). 배달은 실패했지만 주소가 없다는 뜻은 아니다
 *   delayed, 또는 그 밖의 4.x.x             → soft     — 아직 시도 중
 *   그 밖 (delivery-status 없음, delivered·relayed) → unknown
 * 실패로 세는 것은 hard·expired, 보내기 직전 막기(RPL 7-4)는 hard만.
 */
export function classifyDsn(action: string | null | undefined, status: string | null | undefined): DsnKind {
    const a = (action ?? "").trim().toLowerCase();
    const m = DSN_STATUS_RE.exec(status ?? "");
    const cls = m ? m[1] : null;
    if (a === "delivered" || a === "relayed" || a === "expanded") return "unknown";
    if (a === "delayed") return "soft";
    if (a === "failed") {
        if (cls === "5") return "hard";
        if (cls === "4") return "expired";
        return "unknown";
    }
    if (a === "") {
        if (cls === "5") return "hard";
        if (cls === "4") return "soft";
        return "unknown";
    }
    // 모르는 Action: 상태 등급만 본다 (4.x.x는 아직 시도 중으로)
    if (cls === "4") return "soft";
    return "unknown";
}

export type FailSide = "recipient" | "sender";

/**
 * 실패 쪽 (DESIGN-SND 3-1, SND-06): 상태가 5.7.로 시작하거나 사유 글에 SPF·DKIM·DMARC·policy·authenticat가 있으면
 * 우리 도메인 인증·정책 거절(sender), 아니면 받는 쪽(recipient).
 */
export function classifyFailSide(status: string | null | undefined, message: string | null | undefined): FailSide {
    if (/^\s*5\.7\./.test(status ?? "")) return "sender";
    if (/(spf|dkim|dmarc|policy|authenticat)/i.test(message ?? "")) return "sender";
    return "recipient";
}

/**
 * 받는 쪽에서 실패한 발송인가 (후속을 보내지 않을 원본 — F4, PRD SEQ-1 "실패한 메일에는 후속이 가지 않습니다"):
 * status='failed'이고 NHN SST3 또는 배달 실패 출처(반송 안내·NHN)가 있으며, 우리 발신 쪽 실패(SST7·8·5.7.x)가 아니다.
 * 보낼 때 거절(요청 번호 없음)·발신 쪽 실패는 받는 사람 탓이 아니라 아니다
 */
export function isRecipientSideFailure(log: {
    status: string | null;
    nhnStatusCode: string | null;
    deliveryFailSource: string | null;
    deliveryFailSide: string | null;
}): boolean {
    if (log.status !== "failed") return false;
    if (log.deliveryFailSide === "sender" || log.nhnStatusCode === "SST7" || log.nhnStatusCode === "SST8") return false;
    return log.nhnStatusCode === "SST3" || log.deliveryFailSource !== null;
}

/**
 * 반송 막기 목록 갈래 (PRD SND-2, DESIGN-SND 3-1 — F2). hard 반송 신호 하나를 어떻게 막기에 쓰나:
 *   sender    — 우리 발신 쪽 실패 (5.7.x·SPF·DKIM·DMARC·정책 문구, 또는 신호의 fail_side='sender'). 막지 않는다 —
 *               넣으면 멀쩡한 받는 사람(지메일 등)이 조직 전체에서 빠진다
 *   address   — 주소·도메인 없음 (5.1.x, 5.4.4 경로 없음, 5.2.1 계정 사용 중지, 사유 글 "user unknown"·"does not exist" 등). 바로 막는다
 *   transient — 그 밖의 hard (5.2.2 메일함 가득, 5.3.x, 사유 코드 없는 5.0.0 …). 같은 주소에 3번 쌓일 때만 막는다 (BOUNCE_TRANSIENT_BLOCK_COUNT)
 */
export type BounceBlockClass = "sender" | "address" | "transient";

/** 일시 문제로 보는 hard 반송이 이만큼 쌓이면 막는다 (PRD SND-2 "3번 이어질 때만") */
export const BOUNCE_TRANSIENT_BLOCK_COUNT = 3;

const ADDRESS_STATUS_RE = /^\s*5\.(1\.\d{1,3}|4\.4|2\.1)\b/;
const ADDRESS_DIAGNOSTIC_RE =
    /(user unknown|unknown user|no such (user|mailbox|recipient|address|account)|does ?n[o']?t exist|not exist|invalid (recipient|mailbox|address)|recipient address rejected|mailbox (not found|unavailable|does not exist|disabled)|account (is )?(disabled|deactivated|inactive)|unrouteable address|domain not found|host (or domain name )?not found|존재하지 않|없는 (주소|계정|사용자))/i;

export function bounceBlockClass(
    status: string | null | undefined,
    diagnostic: string | null | undefined,
    failSide: string | null | undefined
): BounceBlockClass {
    // 상태 코드가 먼저다: 5.7.x는 발신 쪽, 5.1.x 같은 주소 코드는 사유 글에 "policy"가 섞여 있어도 주소 없음
    if (/^\s*5\.7\./.test(status ?? "")) return "sender";
    if (ADDRESS_STATUS_RE.test(status ?? "")) return "address";
    if (failSide === "sender" || classifyFailSide(status, diagnostic) === "sender") return "sender";
    if (ADDRESS_DIAGNOSTIC_RE.test((diagnostic ?? "").slice(0, 300))) return "address";
    return "transient";
}

/**
 * 한 주소의 hard 반송 신호들 → 막나 (보내기 직전 막기, RPL 7-4 + SND-2). 막으면 막은 근거 신호 id, 아니면 null.
 * signals는 받는 사람 같음·적용된 hard 신호만 (최근 것부터). 발신 쪽 실패는 세지 않는다
 */
export function bounceBlockSignal(
    signals: ReadonlyArray<{ id: number; status: string | null; diagnostic: string | null; failSide: string | null; messageKey: string }>
): number | null {
    let transient: number | null = null;
    const transientKeys = new Set<string>();
    for (const s of signals) {
        const cls = bounceBlockClass(s.status, s.diagnostic, s.failSide);
        if (cls === "address") return s.id;
        if (cls === "transient") {
            transientKeys.add(s.messageKey);
            if (transient === null) transient = s.id;
        }
    }
    return transientKeys.size >= BOUNCE_TRANSIENT_BLOCK_COUNT ? transient : null;
}

const DSN_LABELS: Record<string, string> = {
    "5.1.1": "받는 주소 없음",
    "5.1.2": "받는 도메인 없음",
    "5.1.10": "받는 주소 없음",
    "5.2.1": "받는 계정 사용 중지",
    "5.2.2": "받는 메일함 가득 참",
    "5.4.1": "받는 쪽이 거절함",
    "5.7.1": "받는 쪽 정책으로 거절",
    "5.7.26": "발신 도메인 인증 실패",
    "4.4.7": "재시도 기간 끝남",
    "4.2.2": "받는 메일함 가득 참 (재시도 중)",
};

/** 반송 안내 상태 코드 → 사람이 읽는 짧은 글 (표시용) */
export function dsnLabel(status: string | null | undefined): string {
    const s = (status ?? "").trim();
    if (!s) return "상태 코드 없음";
    const known = DSN_LABELS[s];
    if (known) return `${s} ${known}`;
    if (s.startsWith("5.")) return `${s} 배달 실패`;
    if (s.startsWith("4.")) return `${s} 일시 실패`;
    return s;
}

// ============================================
// NHN 날짜 (KST 벽시계 문자열)
// ============================================

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * NHN Cloud Email API의 날짜 문자열을 Date로 바꾼다. 응답의 resultDate·mailStatusUpdatedDate는 시간대 없는 KST 문자열
 * (예: "2026-05-18 18:59:00")이라 +09:00을 붙여 읽는다. 시간대가 붙은 ISO 문자열이면 그대로 읽는다.
 * 빈 값·읽을 수 없는 값은 null. (nhn-email.ts의 parseNhnDate가 이 함수다 — 순수 시험이 DB 없이 읽게 여기 둔다)
 */
export function parseNhnDate(s: string | null | undefined): Date | null {
    if (!s || !String(s).trim()) return null;
    const t = String(s).trim();
    const d = /[+-]\d{2}:?\d{2}$|Z$/.test(t) ? new Date(t) : new Date(t.replace(" ", "T") + "+09:00");
    return Number.isFinite(d.getTime()) ? d : null;
}

/** Date → NHN 쿼리 형식 KST "yyyy-MM-dd HH:mm:ss" (초 아래는 버린다) */
export function formatNhnDateTime(date: Date): string {
    return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

// ============================================
// NHN 상태 코드 → 발송 기록 (3-1 표)
// ============================================

/** 확정 코드 — 더 바뀌지 않는다. 확정 코드는 확정 코드로만 덮는다 (3-8) */
export const FINAL_NHN_CODES = ["SST2", "SST3", "SST5", "SST7", "SST8"] as const;
/** 아직 진행 중 (준비·발송 중·예약) */
export const PENDING_NHN_CODES = ["SST0", "SST1", "SST4"] as const;

export function isFinalNhnCode(code: string | null | undefined): boolean {
    return (FINAL_NHN_CODES as readonly string[]).includes(String(code ?? ""));
}

/** 발송 기록 한 줄에 쓸 값 (applyNhnStatuses의 VALUES 한 줄) */
export interface NhnStatusWrite {
    /** NHN 상태 코드 그대로 */
    code: string;
    /** 바꿀 status. null = 그대로 (진행 중 코드). 반송 안내(dsn)로 이미 실패면 SQL이 failed를 지킨다 */
    logStatus: "sent" | "failed" | null;
    final: boolean;
    /** result_code (실패 코드일 때만 쓴다, 20자) */
    reasonCode: string | null;
    /** result_message (실패 코드일 때만 쓴다). dsnMessage는 DB에만 둔다 — 로그·챗에 넣지 않는다 */
    reasonText: string | null;
    /** NHN resultDate (확정일 때 completed_at·delivery_failed_at) */
    resultAt: Date | null;
    /** SST3의 dsnCode (5.1.1 등) */
    dsnCode: string | null;
    /** SST7·8 → sender, SST3 → classifyFailSide, 그 밖 null */
    failSide: FailSide | null;
}

const FAIL_LABELS: Record<string, string> = {
    SST3: "발송 실패(SST3)",
    SST5: "NHN 수신거부(SST5)",
    SST7: "발신 인증 실패(SST7)",
    SST8: "화이트리스트로 인한 실패(SST8)",
};

function clean(v: string | null | undefined): string | null {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t : null;
}

/**
 * NHN 결과 한 줄 → 발송 기록에 쓸 값 (DESIGN-SND 3-1).
 *   SST0·1·4 → 진행 중 (status 그대로)        SST2 → sent
 *   SST3 → failed + dsnCode·dsnMessage (없으면 "발송 실패(SST3)") + 실패 쪽(classifyFailSide)
 *   SST5·7·8 → failed + 코드별 사유 글. SST7·8은 발신 쪽 실패
 * 모르는 코드는 null — 쓰지 않는다 (보조 질문이 다시 물을 수 있게. 부른 쪽이 경고 로그를 한 번 남긴다)
 */
export function mapNhnStatus(input: {
    mailStatusCode: string | null | undefined;
    dsnCode?: string | null;
    dsnMessage?: string | null;
    resultDate?: string | null;
}): NhnStatusWrite | null {
    const code = String(input.mailStatusCode ?? "").trim().toUpperCase();
    const resultAt = parseNhnDate(input.resultDate ?? null);
    if ((PENDING_NHN_CODES as readonly string[]).includes(code)) {
        return { code, logStatus: null, final: false, reasonCode: null, reasonText: null, resultAt: null, dsnCode: null, failSide: null };
    }
    if (code === "SST2") {
        return { code, logStatus: "sent", final: true, reasonCode: null, reasonText: null, resultAt, dsnCode: null, failSide: null };
    }
    if (code === "SST3") {
        const dsnCode = clean(input.dsnCode);
        const dsnMessage = clean(input.dsnMessage);
        return {
            code,
            logStatus: "failed",
            final: true,
            reasonCode: (dsnCode ?? "SST3").slice(0, 20),
            reasonText: (dsnMessage ?? FAIL_LABELS.SST3).slice(0, 500),
            resultAt,
            dsnCode: dsnCode ? dsnCode.slice(0, 16) : null,
            failSide: classifyFailSide(dsnCode, dsnMessage),
        };
    }
    if (code === "SST5" || code === "SST7" || code === "SST8") {
        return {
            code,
            logStatus: "failed",
            final: true,
            reasonCode: code,
            reasonText: FAIL_LABELS[code],
            resultAt,
            dsnCode: null,
            failSide: code === "SST5" ? null : "sender",
        };
    }
    return null;
}

// ============================================
// update-mails 커서 창 (3-2·3-6)
// ============================================

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const UPDATE_WINDOW = {
    /** 창 앞을 이만큼 겹쳐 읽는다 — NHN 쪽 늦은 기록. 다시 써도 결과가 같다 (확정은 확정으로만 덮는다) */
    overlapMs: 5 * MINUTE_MS,
    /** 창 하나의 길이 */
    lengthMs: HOUR_MS,
    /** 쪽이 많아 창을 줄일 때의 가장 짧은 길이 (shrinkUpdateSpan, UX-197) */
    minLengthMs: MINUTE_MS,
    /** 지금에서 이만큼 뒤까지만 읽는다 (막 바뀐 상태가 목록에 아직 없을 수 있다) */
    lagMs: MINUTE_MS,
    /** 커서가 지금 − 이 값 안으로 들어오면 처음 따라잡기가 끝났다 (initial_done_at) */
    caughtUpMs: HOUR_MS,
} as const;

/** 처음 커서: now − backfillDays일. 0이면 now − 1시간 (3-6) */
export function initialCursor(now: Date, backfillDays: number): Date {
    const days = Number.isFinite(backfillDays) && backfillDays > 0 ? backfillDays : 0;
    return new Date(now.getTime() - (days > 0 ? days * 24 * HOUR_MS : HOUR_MS));
}

/**
 * 이번에 읽을 창 [cursor − 5분, min(cursor + 1시간, now − 1분)]. 읽을 것이 없으면(커서가 지금을 따라잡음) null.
 * 창을 쪽 끝까지 다 읽은 뒤에만 커서를 창 끝(end)으로 옮긴다.
 */
export function nextUpdateWindow(
    cursor: Date,
    now: Date,
    lengthMs: number = UPDATE_WINDOW.lengthMs
): { start: Date; end: Date } | null {
    const end = Math.min(cursor.getTime() + lengthMs, now.getTime() - UPDATE_WINDOW.lagMs);
    // 초 단위로 묻는다 — 초 아래만 남은 창은 읽을 것이 없다
    if (Math.floor(end / 1000) <= Math.floor(cursor.getTime() / 1000)) return null;
    return { start: new Date(cursor.getTime() - UPDATE_WINDOW.overlapMs), end: new Date(end) };
}

/**
 * 창 하나를 끝까지 읽을 쪽 수(pagesNeeded)가 이번 회차에 더 물을 수 있는 수(pagesAffordable)보다 많으면 창 길이를 그 비율로
 * 줄인다 (UX-197). 예전에는 같은 창을 매 회차 첫 쪽부터 읽다 예산에서 멈춰 커서가 영영 움직이지 않았다.
 * 돌려주는 값: 다음에 물을 창 길이(초 단위로 내림, minLengthMs 이상). 줄일 필요가 없으면 spanMs 그대로,
 * 더 줄일 수 없거나(이미 가장 짧다) 물을 수가 없으면 null — 부르는 쪽은 예산이 모자란 것으로 보고 커서를 옮기지 않는다.
 */
export function shrinkUpdateSpan(spanMs: number, pagesNeeded: number, pagesAffordable: number): number | null {
    if (!(pagesAffordable >= 1)) return null;
    if (pagesNeeded <= pagesAffordable) return spanMs;
    const scaled = Math.floor((spanMs * pagesAffordable) / pagesNeeded / 1000) * 1000;
    const next = Math.max(UPDATE_WINDOW.minLengthMs, scaled);
    return next < spanMs ? next : null;
}

export function isCursorCaughtUp(cursor: Date, now: Date): boolean {
    return cursor.getTime() >= now.getTime() - UPDATE_WINDOW.caughtUpMs;
}

// ============================================
// 짝짓기 (3-2·3-3)
// ============================================

export interface UpdatedMailLike {
    requestId: string;
    mailSeq?: number | null;
    mailStatusCode: string;
    mailStatusUpdatedDate?: string | null;
    resultDate?: string | null;
    dsnCode?: string | null;
    dsnMessage?: string | null;
}

/** 같은 요청 번호가 창 겹침·상태 변화로 여러 번 오면 하나만: 확정 코드가 먼저, 같으면 나중에 바뀐 것 */
function better<T extends UpdatedMailLike>(a: T, b: T): T {
    const fa = isFinalNhnCode(a.mailStatusCode);
    const fb = isFinalNhnCode(b.mailStatusCode);
    if (fa !== fb) return fa ? a : b;
    const ta = String(a.mailStatusUpdatedDate ?? a.resultDate ?? "");
    const tb = String(b.mailStatusUpdatedDate ?? b.resultDate ?? "");
    return tb >= ta ? b : a;
}

export interface PairedUpdate<T> {
    logId: number;
    mail: T;
}

/**
 * update-mails 결과(받는 주소 없음)를 요청 번호로 발송 기록과 짝짓는다. 샌드비 발송은 1통 1요청이라 요청 번호 안의 기록이
 * 하나면 그대로 잇는다. 기록이 여럿이면(예외) 그 요청 번호를 multiRequestIds로 돌려 요청 번호 조회(받는 주소 포함)로 넘긴다.
 * 우리 기록이 없는 결과(같은 appKey를 쓰는 시험 발송·초대 메일 등)는 unpaired로 센다.
 */
export function pairUpdatedMails<T extends UpdatedMailLike>(
    updates: readonly T[],
    logs: ReadonlyArray<{ id: number; requestId: string | null }>
): { pairs: Array<PairedUpdate<T>>; unpaired: number; multiRequestIds: string[] } {
    const best = new Map<string, T>();
    for (const u of updates) {
        const rid = String(u.requestId ?? "").trim();
        if (!rid) continue;
        const key = `${rid}|${u.mailSeq ?? 0}`;
        const prev = best.get(key);
        best.set(key, prev ? better(prev, u) : u);
    }
    const logsByRid = new Map<string, number[]>();
    for (const l of logs) {
        if (!l.requestId) continue;
        const list = logsByRid.get(l.requestId) ?? [];
        list.push(l.id);
        logsByRid.set(l.requestId, list);
    }
    const pairs: Array<PairedUpdate<T>> = [];
    const multi = new Set<string>();
    let unpaired = 0;
    for (const u of best.values()) {
        const rid = String(u.requestId).trim();
        const ids = logsByRid.get(rid) ?? [];
        if (ids.length === 0) unpaired++;
        else if (ids.length === 1) pairs.push({ logId: ids[0], mail: u });
        else multi.add(rid);
    }
    return { pairs, unpaired, multiRequestIds: [...multi] };
}

/** 받는 주소 비교 모양 — lower(trim()) (DESIGN-SND 3-2, PRD SND-1 수용 기준 3) */
export function normalizeRecipient(email: string | null | undefined): string {
    return String(email ?? "").trim().toLowerCase();
}

/**
 * 요청 번호 조회 결과(받는 주소 있음)를 발송 기록과 짝짓는다 (3-3 보조 질문·짝이 여럿인 예외).
 * 요청 번호 안에 기록과 결과가 하나씩이면 주소가 달라도 잇는다 (NHN이 대문자로 줘도 — H2). 여럿이면 lower(trim(주소))로 잇는다.
 */
export function pairNhnRows<T extends UpdatedMailLike & { receiveMailAddr?: string | null }>(
    mails: readonly T[],
    logs: ReadonlyArray<{ id: number; requestId: string | null; recipientEmail: string }>
): Array<PairedUpdate<T>> {
    const mailsByRid = new Map<string, T[]>();
    for (const m of mails) {
        const rid = String(m.requestId ?? "").trim();
        if (!rid) continue;
        const list = mailsByRid.get(rid) ?? [];
        list.push(m);
        mailsByRid.set(rid, list);
    }
    const logsByRid = new Map<string, Array<{ id: number; recipientEmail: string }>>();
    for (const l of logs) {
        if (!l.requestId) continue;
        const list = logsByRid.get(l.requestId) ?? [];
        list.push(l);
        logsByRid.set(l.requestId, list);
    }
    const out: Array<PairedUpdate<T>> = [];
    for (const [rid, ls] of logsByRid) {
        const ms = mailsByRid.get(rid) ?? [];
        if (ms.length === 0) continue;
        if (ls.length === 1 && ms.length === 1) {
            out.push({ logId: ls[0].id, mail: ms[0] });
            continue;
        }
        for (const l of ls) {
            const want = normalizeRecipient(l.recipientEmail);
            let pick: T | null = null;
            for (const m of ms) {
                if (normalizeRecipient(m.receiveMailAddr) !== want) continue;
                pick = pick ? better(pick, m) : m;
            }
            if (pick) out.push({ logId: l.id, mail: pick });
        }
    }
    return out;
}

// ============================================
// 설정 (11절)
// ============================================

export interface StatusSyncConfig {
    /** NHN_STATUS_SYNC=off면 동기화 cron이 아무것도 안 한다 */
    enabled: boolean;
    /** 회차마다 NHN 질문 상한 (update-mails 쪽 + 보조 질문) */
    maxCalls: number;
    /** 회차마다 보조 요청 번호 질문 상한 (3-3) */
    fallbackCalls: number;
    /** 처음 커서를 며칠 전에서 시작하나 (0 = 1시간 전) */
    backfillDays: number;
    /** update-mails 쪽 크기 [NHN 최댓값 확인 필요] */
    pageSize: number;
}

function intEnv(v: string | undefined, def: number, min: number, max: number): number {
    const t = (v ?? "").trim();
    if (!/^\d+$/.test(t)) return def;
    const n = Number(t);
    return Number.isSafeInteger(n) ? Math.min(max, Math.max(min, n)) : def;
}

export function resolveStatusSyncConfig(env: Record<string, string | undefined>): StatusSyncConfig {
    return {
        enabled: (env.NHN_STATUS_SYNC ?? "on").trim().toLowerCase() !== "off",
        maxCalls: intEnv(env.NHN_STATUS_SYNC_MAX_CALLS, 300, 1, 5000),
        fallbackCalls: intEnv(env.NHN_STATUS_FALLBACK_CALLS, 30, 0, 1000),
        backfillDays: intEnv(env.NHN_STATUS_BACKFILL_DAYS, 8, 0, 60),
        pageSize: intEnv(env.NHN_STATUS_PAGE_SIZE, 100, 1, 1000),
    };
}

/**
 * 화면 "동기화" 버튼의 경고 문구 (UX-260). 조회가 실패했는데 "0건 업데이트" 성공처럼 보이지 않게 한다.
 * 실패가 없으면 null. 키 오류면 설정 확인을, 그 밖은 일부 실패와 다시 시도를 안내한다. 문구 앞부분은 상태 줄과 같은 failureText.
 */
export function syncWarning(stats: { errors: number; lastFailure?: { kind: NhnFailureKind; text: string } }): string | null {
    const f = stats.lastFailure;
    if (f?.kind === "auth") {
        return `${f.text} — NHN에서 결과를 가져오지 못했습니다. 이메일 화면 '설정'에서 appKey·secretKey를 확인해주세요.`;
    }
    if (stats.errors > 0 || f) {
        return `${f?.text ?? "NHN 조회 일시 오류"} — 결과 조회 일부가 실패했습니다. 잠시 뒤 다시 동기화해주세요.`;
    }
    return null;
}

/** NHN 조회 실패 갈래 (3-5). 400은 update-mails에서 창 시작이 하루보다 오래됐을 때만 "오래된 창 거절"로 본다 (3-6, OPS-7) */
export type NhnFailureKind = "auth" | "rate_limited" | "transient" | "rejected_window";

/**
 * 이보다 오래된 창의 400만 "오래된 기간 거절"로 보고 건너뛴다. 그보다 새 창의 400은 설정 오류(NHN_STATUS_PAGE_SIZE가 NHN 최댓값보다 큼)나
 * NHN 매개변수 변경일 수 있어 일시 오류로 센다 — 커서를 넘기지 않고 연속 오류·정체 알림으로 드러난다 (OPS-7)
 */
export const REJECTED_WINDOW_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export function classifyNhnFailure(
    httpStatus: number | null,
    opts: { updateWindow?: boolean; windowStart?: Date; now?: Date } = {}
): NhnFailureKind {
    if (httpStatus === 401 || httpStatus === 403) return "auth";
    if (httpStatus === 429) return "rate_limited";
    if (httpStatus === 400 && opts.updateWindow && opts.windowStart && opts.now) {
        if (opts.now.getTime() - opts.windowStart.getTime() > REJECTED_WINDOW_MIN_AGE_MS) return "rejected_window";
    }
    return "transient";
}

// ============================================
// 회차 예산 (3-4)
// ============================================

/**
 * NHN 질문 예산 total을 묶음마다 나눈다. 먼저 고르게 나누고, 몫보다 덜 쓰는 묶음의 남는 몫을 더 필요한 묶음에 다시 준다
 * (물 채우기). demands[i] = 그 묶음이 이번 회차에 쓸 수 있을 만큼 (밀린 창 수 + 보조 질문 수, 모르면 크게).
 * 몫의 합은 total을 넘지 않는다.
 */
export function splitBudget(total: number, demands: readonly number[]): number[] {
    const n = demands.length;
    const out = new Array<number>(n).fill(0);
    let left = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
    const want = demands.map((d) => Math.max(0, Math.floor(Number.isFinite(d) ? d : 0)));
    let open = want.map((_, i) => i).filter((i) => want[i] > 0);
    while (left > 0 && open.length > 0) {
        const share = Math.floor(left / open.length);
        if (share === 0) {
            // 나눌 수 없을 만큼 남았다 — 앞 묶음부터 하나씩
            for (const i of open) {
                if (left === 0) break;
                out[i]++;
                left--;
            }
            break;
        }
        const next: number[] = [];
        for (const i of open) {
            const give = Math.min(share, want[i] - out[i]);
            out[i] += give;
            left -= give;
            if (out[i] < want[i]) next.push(i);
        }
        open = next;
    }
    return out;
}
