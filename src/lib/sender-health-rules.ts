/**
 * 발신 건강 판정 (SND-3) — 순수 규칙. DB를 모른다 (@/lib/db import 금지). 웜업 규칙 파일과 같은 방식이다.
 * 설계: docs/2026-10-11-reply-and-health/DESIGN-SND.md 5~7절.
 *
 * - resolveSendHealthConfig: SEND_HEALTH_MODE(off·dry_run·alert·enforce, 모르는 값은 dry_run) 등 환경 값
 * - healthCategoryOf / HEALTH_CATEGORY_SQL: 발송 기록 하나의 갈래 (5-1 표) — TS와 SQL이 같은 순서다
 * - evaluateHealth: 7일 묶음(+ 느린 명단 30일, + 최근 1시간) → 명단·주소·도메인 상태
 * - isOutlierCell·binomUpperTail: 주소 × 명단 칸이 같은 명단의 다른 주소보다 뚜렷이 높은가 (5-4)
 * - syncGate·planActions: 모드·동기화 관문·예외·상한·기본 주소 → 사건과 조치 (6절)
 * - dedupeKey·isQuietHour·글 만들기·resolveHealthWebhook (7절)
 * 문턱 값은 코드 상수다 (DEFAULT_THRESHOLDS). 운영하며 고칠 때 순수 시험이 함께 바뀐다.
 */
import { addDaysYmd, formatKstShort, kstParts, weekdayOfYmd } from "@/lib/kst";
import { dsnLabel } from "@/lib/email-status-sync-rules";
import { chatSafe } from "@/lib/chat-text";
import { chatWebhookProblem, chatWebhookProblemText } from "@/lib/google-chat";

/**
 * 발송 건강 글에 넣는 사용자 값 (명단·사업·조직 이름, 우리 발신 주소, 규칙 이름, 메모). `<` `>`·줄바꿈·꾸밈 글자·맨 URL이
 * 전체 멘션·가짜 링크·가짜 줄로 끼어들지 못하게 한다 (HB-1·HS-2·HD-01·HR-1·HR-2). max면 코드 포인트로 자른다 (HR-10)
 */
function u(value: unknown, max?: number): string {
    return chatSafe(value, { defangUrls: true, max });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ============================================
// 설정
// ============================================

export type SendHealthMode = "off" | "dry_run" | "alert" | "enforce";

export interface HealthThresholds {
    windowMs: number;
    /** 느린 명단 보조 창 (SND-17) */
    slowWindowMs: number;
    partitionMinFinal: number;
    dangerRateBp: number;
    cautionRateBp: number;
    /** 칸 확정 최소 */
    pairMinFinal: number;
    /** 칸 실패 최소 */
    pairMinFailed: number;
    /** 같은 명단 다른 주소 확정 최소 (비교할 재료) */
    pairRestMinFinal: number;
    /** 다른 주소 실패율 바닥 0.5% (0으로 비교하지 않게) */
    pairRestFloorBp: number;
    /** 칸이 "우연히" 이만큼 높을 확률 상한 (5-4) */
    pairMaxPValue: number;
    senderDangerMinPartitions: number;
    /** PRD 규칙(명단 2개 이상에서 함께 5% 이상)으로 주소 위험을 볼 때, 그 칸들의 확정 합 최소 (표본 하한, F3) */
    senderMultiMinFinal: number;
    senderCautionMinFinal: number;
    /** 명단 확정의 50% 이상 = 주된 발신 (SND-07) */
    primarySenderShareBp: number;
    senderSideLookbackMs: number;
    /** 발신 쪽 실패 폭주 창 (SND-06) */
    authBurstWindowMs: number;
    authBurstMinCount: number;
    authBurstMinRateBp: number;
    authBurstHardCount: number;
    /** 대상 미확정 비율이 20%를 넘으면 enforce 대신 알림 (SND-02) */
    maxUnconfirmedBp: number;
    /** 동기화 마지막 성공이 30분보다 오래되면 enforce 대신 알림 */
    syncStaleMs: number;
    /** 위험에서 벗어나 이만큼 지나 다시 위험이면 새 위험 구간(바로 알림). 그 안이면 같은 구간 — 5% 언저리 오르내림에 알림이 몰리지 않게 (F7) */
    dangerEpisodeGapMs: number;
}

export const DEFAULT_THRESHOLDS: Readonly<HealthThresholds> = Object.freeze({
    windowMs: 7 * DAY_MS,
    slowWindowMs: 30 * DAY_MS,
    partitionMinFinal: 200,
    dangerRateBp: 500,
    cautionRateBp: 300,
    pairMinFinal: 50,
    pairMinFailed: 3,
    pairRestMinFinal: 100,
    pairRestFloorBp: 50,
    pairMaxPValue: 0.01,
    senderDangerMinPartitions: 2,
    senderMultiMinFinal: 200,
    senderCautionMinFinal: 200,
    primarySenderShareBp: 5000,
    senderSideLookbackMs: 24 * HOUR_MS,
    authBurstWindowMs: HOUR_MS,
    authBurstMinCount: 3,
    authBurstMinRateBp: 2000,
    authBurstHardCount: 10,
    maxUnconfirmedBp: 2000,
    syncStaleMs: 30 * 60 * 1000,
    dangerEpisodeGapMs: 24 * HOUR_MS,
});

/** 밤 시간 (KST 22~08시) — 조치·폭주·정체가 없으면 알림을 보내지 않고 09시 매일 보고에 싣는다 (SND-13) */
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 8;

export interface SendHealthConfig {
    mode: SendHealthMode;
    /** "반송만"(NHN 성공 뒤 반송 안내)을 실패율에 넣나 (SEND_HEALTH_DSN_IN_RATE, 기본 off — SND-02) */
    dsnInRate: boolean;
    /** 매일 보고 시각 (KST 0~23) */
    reportHour: number;
    maxAutoPausePerDay: number;
    maxAuthPauseDomainsPerDay: number;
    /** 알림만 할 명단 id (실험 명단 등) */
    alertOnlyPartitionIds: number[];
    /** 알림 링크 앞부분 */
    baseUrl: string;
    /**
     * 판정·조치할 조직 (OPS-2). SEND_HEALTH_ORG_IDS: "*"(또는 all) = 이메일 설정이 켜진 모든 조직, 조직 id 쉼표 = 그 조직만,
     * 비면 default = 회신 읽기·깊이 알림 워크스페이스(REPLY_WORKSPACE_IDS·DEEP_ALERT_WORKSPACE_IDS)의 조직 (우리 조직).
     * 샌드비는 여러 조직이 쓴다 — 다른 고객사 명단을 보류하거나 그 명단 이름·주소를 우리 운영 스페이스로 보내지 않게
     */
    orgScope: { kind: "all" } | { kind: "ids"; orgIds: string[] } | { kind: "default"; workspaceIds: number[] };
}

function intEnv(v: string | undefined, def: number, min: number, max: number): number {
    const t = (v ?? "").trim();
    if (!/^\d+$/.test(t)) return def;
    const n = Number(t);
    return Number.isSafeInteger(n) ? Math.min(max, Math.max(min, n)) : def;
}

function idList(v: string | undefined): number[] {
    const out: number[] = [];
    for (const part of (v ?? "").split(",")) {
        const s = part.trim();
        if (!/^\d+$/.test(s)) continue;
        const n = Number(s);
        if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/** 11절. 모르는 모드·빈 값은 dry_run — 오타 하나로 자동 조치가 켜지거나 기록이 꺼지지 않게 (깊이 알림과 같은 원칙) */
export function resolveSendHealthConfig(env: Record<string, string | undefined>): SendHealthConfig {
    const raw = (env.SEND_HEALTH_MODE ?? "").trim().toLowerCase();
    const mode: SendHealthMode = raw === "off" || raw === "alert" || raw === "enforce" || raw === "dry_run" ? raw : "dry_run";
    return {
        mode,
        dsnInRate: (env.SEND_HEALTH_DSN_IN_RATE ?? "").trim().toLowerCase() === "on",
        reportHour: intEnv(env.SEND_HEALTH_REPORT_HOUR, 9, 0, 23),
        maxAutoPausePerDay: intEnv(env.SEND_HEALTH_MAX_AUTO_PAUSE_PER_DAY, 5, 0, 1000),
        maxAuthPauseDomainsPerDay: intEnv(env.SEND_HEALTH_MAX_AUTH_PAUSE_DOMAINS_PER_DAY, 10, 0, 1000),
        alertOnlyPartitionIds: idList(env.SEND_HEALTH_ALERT_ONLY_PARTITION_IDS),
        baseUrl: ((env.NEXT_PUBLIC_BASE_URL ?? "").trim() || "https://sendb.kr").replace(/\/+$/, ""),
        orgScope: parseOrgScope(env),
    };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOrgScope(env: Record<string, string | undefined>): SendHealthConfig["orgScope"] {
    const raw = (env.SEND_HEALTH_ORG_IDS ?? "").trim();
    if (raw === "*" || raw.toLowerCase() === "all") return { kind: "all" };
    const orgIds: string[] = [];
    for (const part of raw.split(",")) {
        const id = part.trim().toLowerCase();
        if (UUID_RE.test(id) && !orgIds.includes(id)) orgIds.push(id);
    }
    if (orgIds.length > 0) return { kind: "ids", orgIds };
    const ws = [...idList(env.REPLY_WORKSPACE_IDS), ...idList(env.DEEP_ALERT_WORKSPACE_IDS)];
    return { kind: "default", workspaceIds: [...new Set(ws)] };
}

/**
 * 알림 받는 곳 (7-2). ops = SEND_HEALTH_WEBHOOK_URL. 워크스페이스 = SEND_HEALTH_WEBHOOK_URL_<id>, 없으면 DEEP_ALERT_WEBHOOK_URL_<id>
 * (깊이 알림과 같은 사업 스페이스). 깊이 알림 공통 주소(DEEP_ALERT_WEBHOOK_URL)는 쓰지 않는다 — 사업 담당용이다.
 * 구글 챗 수신 웹훅 주소만 (CT-6). 값이 있는데 형식이 틀리면 다음 값으로 넘어가지 않고 형식 오류로 둔다 — 설정 실수가
 * "웹훅 없음"이나 다른 스페이스로 조용히 바뀌지 않게 (HR-13). source = 고칠 환경 변수 이름 (주소는 남기지 않는다)
 */
export function healthWebhookInfo(
    env: Record<string, string | undefined>,
    target: "ops" | number
): { url: string | null; source: string; problem: string | null } {
    const check = (source: string, raw: string) => {
        const p = chatWebhookProblem(raw);
        return { url: p ? null : raw, source, problem: p ? chatWebhookProblemText(p) : null };
    };
    if (target === "ops") return check("SEND_HEALTH_WEBHOOK_URL", (env.SEND_HEALTH_WEBHOOK_URL ?? "").trim());
    const own = (env[`SEND_HEALTH_WEBHOOK_URL_${target}`] ?? "").trim();
    if (own) return check(`SEND_HEALTH_WEBHOOK_URL_${target}`, own);
    return check(`DEEP_ALERT_WEBHOOK_URL_${target}`, (env[`DEEP_ALERT_WEBHOOK_URL_${target}`] ?? "").trim());
}

export function resolveHealthWebhook(env: Record<string, string | undefined>, target: "ops" | number): string | null {
    return healthWebhookInfo(env, target).url;
}

// ============================================
// 갈래 (5-1)
// ============================================

export type HealthCategory = "test" | "sender_side" | "nhn_unsub" | "failed" | "dsn_only" | "success" | "send_reject" | "unknown";

export interface SendLogFacts {
    triggerType: string | null;
    status: string;
    requestId: string | null;
    nhnStatusCode: string | null;
    deliveryFailSource: string | null;
    deliveryFailSide: string | null;
}

const FINAL_CODES = ["SST2", "SST3", "SST5", "SST7", "SST8"];

/**
 * 발송 기록 하나의 갈래 (위에서부터 먼저). HEALTH_CATEGORY_SQL과 같은 순서·같은 조건이다 — 하나를 고치면 둘 다 고친다.
 *   시험 발송 → 안 셈 · 발신 쪽 실패(NHN 확정 + sender) → 명단 실패율에서 뺌 · SST5 → 뺌 · SST3 → 실패 ·
 *   SST2 + 반송 안내 → 반송만 · SST2 → 성공 · 보낼 때 거절 → 뺌 · 그 밖(NHN 결과 없는 반송 포함) → 미확정
 */
export function healthCategoryOf(f: SendLogFacts): HealthCategory {
    if ((f.triggerType ?? "").startsWith("test")) return "test";
    const code = f.nhnStatusCode;
    const final = code !== null && FINAL_CODES.includes(code);
    if (final && (f.deliveryFailSide === "sender" || code === "SST7" || code === "SST8")) return "sender_side";
    if (code === "SST5") return "nhn_unsub";
    if (code === "SST3") return "failed";
    if (code === "SST2" && f.deliveryFailSource === "dsn") return "dsn_only";
    if (code === "SST2") return "success";
    if (f.requestId === null || (f.status === "failed" && code === null && f.deliveryFailSource === null)) return "send_reject";
    return "unknown";
}

/** healthCategoryOf와 같은 갈래 (별칭 l = email_send_logs) */
export const HEALTH_CATEGORY_SQL = `CASE
    WHEN COALESCE(l.trigger_type, '') LIKE 'test%' THEN 'test'
    WHEN l.nhn_status_code IN ('SST2','SST3','SST5','SST7','SST8')
         AND (l.delivery_fail_side = 'sender' OR l.nhn_status_code IN ('SST7','SST8')) THEN 'sender_side'
    WHEN l.nhn_status_code = 'SST5' THEN 'nhn_unsub'
    WHEN l.nhn_status_code = 'SST3' THEN 'failed'
    WHEN l.nhn_status_code = 'SST2' AND l.delivery_fail_source = 'dsn' THEN 'dsn_only'
    WHEN l.nhn_status_code = 'SST2' THEN 'success'
    WHEN l.request_id IS NULL OR (l.status = 'failed' AND l.nhn_status_code IS NULL AND l.delivery_fail_source IS NULL) THEN 'send_reject'
    ELSE 'unknown'
END`;

/** 갈래별 수 */
export interface Tally {
    success: number;
    failed: number;
    dsnOnly: number;
    senderSide: number;
    nhnUnsub: number;
    unknown: number;
}

export function emptyTally(): Tally {
    return { success: 0, failed: 0, dsnOnly: 0, senderSide: 0, nhnUnsub: 0, unknown: 0 };
}

export function addTally(into: Tally, b: Tally): Tally {
    into.success += b.success;
    into.failed += b.failed;
    into.dsnOnly += b.dsnOnly;
    into.senderSide += b.senderSide;
    into.nhnUnsub += b.nhnUnsub;
    into.unknown += b.unknown;
    return into;
}

/** 확정 = 실패 + 성공 (+ DSN_IN_RATE면 반송만). 실패율 = 실패 ÷ 확정 (5-1) */
export function finalOf(t: Tally, dsnInRate: boolean): number {
    return t.success + t.failed + (dsnInRate ? t.dsnOnly : 0);
}

export function failedOf(t: Tally, dsnInRate: boolean): number {
    return t.failed + (dsnInRate ? t.dsnOnly : 0);
}

/** 만분율 (표시·사건 키용). 확정이 0이면 null */
export function rateBp(failed: number, final: number): number | null {
    if (!(final > 0)) return null;
    return Math.round((failed * 10000) / final);
}

/** 정수로 비교한다: failed × 10000 ≥ final × bp */
export function atLeastBp(failed: number, final: number, bp: number): boolean {
    return final > 0 && failed * 10000 >= final * bp;
}

export function formatRate(bp: number | null): string {
    if (bp === null) return "-";
    return `${(bp / 100).toFixed(1)}%`;
}

// ============================================
// 이항 윗꼬리 (5-4)
// ============================================

/**
 * P(X ≥ k), X ~ 이항(n, p). 반복 곱셈·로그로 계산한다 (n은 많아야 수천). 아래 꼬리를 1에서 빼지 않고 윗꼬리를 바로 더해
 * 작은 확률에서도 자릿수를 잃지 않는다.
 */
export function binomUpperTail(n: number, k: number, p: number): number {
    if (!(n >= 0) || !Number.isFinite(n)) return 1;
    n = Math.floor(n);
    k = Math.ceil(k);
    if (k <= 0) return 1;
    if (k > n) return 0;
    if (!(p > 0)) return 0;
    if (p >= 1) return 1;
    // log pmf(k) = log C(n,k) + k log p + (n-k) log(1-p)
    let logC = 0;
    for (let i = 1; i <= k; i++) logC += Math.log((n - k + i) / i);
    let logPmf = logC + k * Math.log(p) + (n - k) * Math.log1p(-p);
    let pmf = Math.exp(logPmf);
    let sum = pmf;
    const ratio = p / (1 - p);
    for (let i = k; i < n; i++) {
        logPmf += Math.log((n - i) / (i + 1)) + Math.log(ratio);
        pmf = Math.exp(logPmf);
        sum += pmf;
        // 최빈값을 지나 남은 항이 무시할 만하면 그만
        if (i + 1 > n * p && pmf < sum * 1e-15) break;
    }
    return Math.min(1, sum);
}

export interface CellJudge {
    /** 칸 (주소 s × 명단 p, 두 하한 뒤 발송만) */
    final: number;
    failed: number;
    /** 같은 명단의 나머지 주소 (p 전체 − 칸) */
    restFinal: number;
    restFailed: number;
}

export interface CellVerdict {
    eligible: boolean;
    outlier: boolean;
    pValue: number | null;
    /** 비교 바닥을 적용한 나머지 실패율 (만분율) */
    restRateBp: number | null;
}

/**
 * 뚜렷이 높은 칸 (5-4) — 모두 만족:
 *   1. 칸 확정 ≥ 50, 실패 ≥ 3, 실패율 ≥ 5%
 *   2. 같은 명단 나머지 주소 확정 ≥ 100. 나머지 실패율 r0 = max(나머지 실패율, 0.5%)
 *   3. P(X ≥ 칸 실패 | n = 칸 확정, p = r0) < 0.01
 * eligible = 판정할 재료가 있는 칸 (칸 50통·나머지 100통)
 */
export function isOutlierCell(c: CellJudge, t: HealthThresholds = DEFAULT_THRESHOLDS): CellVerdict {
    const eligible = c.final >= t.pairMinFinal && c.restFinal >= t.pairRestMinFinal;
    if (!eligible) return { eligible, outlier: false, pValue: null, restRateBp: rateBp(c.restFailed, c.restFinal) };
    const r0 = Math.max(c.restFinal > 0 ? c.restFailed / c.restFinal : 0, t.pairRestFloorBp / 10000);
    const restBp = Math.round(r0 * 10000);
    if (c.failed < t.pairMinFailed || !atLeastBp(c.failed, c.final, t.dangerRateBp)) {
        return { eligible, outlier: false, pValue: null, restRateBp: restBp };
    }
    const pValue = binomUpperTail(c.final, c.failed, r0);
    return { eligible, outlier: pValue < t.pairMaxPValue, pValue, restRateBp: restBp };
}

// ============================================
// 판정 (5-2·5-3·5-4)
// ============================================

export type HealthState = "ok" | "caution" | "danger" | "insufficient";
export type EvalWindow = "7d" | "30d";

/** 7일 시간 묶음 한 줄 (6-0 ①). afterP·afterS = 그 대상의 재판정 하한 뒤 발송인가 */
export interface HealthBucket extends Tally {
    partitionId: number | null;
    /** null = 프로필 없는 예전 기본 주소 (s:0) */
    senderProfileId: number | null;
    senderDomain: string;
    hourStart: Date;
    afterP: boolean;
    afterS: boolean;
}

/** 느린 명단 30일 (6-0 ②) */
export interface SlowRow {
    partitionId: number;
    afterP: boolean;
    firstSentAt: Date | null;
    success: number;
    failed: number;
    dsnOnly: number;
}

/** 최근 1시간 도메인·주소별 (6-0 ③) */
export interface BurstRow extends Tally {
    senderDomain: string;
    senderProfileId: number | null;
}

export interface HealthPartitionInfo {
    id: number;
    workspaceId: number;
    name: string;
    /** 재판정 하한 = 가장 최근 보류의 released_at */
    floorAt: Date | null;
    /** 풀리지 않은 보류 id */
    activeHoldId: number | null;
    /** 최근 7일 안에 보류되었거나 풀렸다 (주소 칸에서 뺀다 — SND-04 (2)) */
    heldOrReleasedRecently: boolean;
    /** SEND_HEALTH_ALERT_ONLY_PARTITION_IDS */
    alertOnly: boolean;
}

export interface HealthSenderInfo {
    id: number;
    email: string;
    domain: string;
    isDefault: boolean;
    isPaused: boolean;
    /** manual | auto | null */
    pausedSource: string | null;
    /** auto | alert */
    healthAction: string;
    /** 재판정 하한 = health_reset_at */
    floorAt: Date | null;
}

export interface EvaluateInput {
    now: Date;
    dsnInRate: boolean;
    thresholds?: HealthThresholds;
    buckets: readonly HealthBucket[];
    slow: readonly SlowRow[];
    burst: readonly BurstRow[];
    partitions: readonly HealthPartitionInfo[];
    senders: readonly HealthSenderInfo[];
    /** 지난 7일 안에 주의·위험이었던 대상 키 (p:<id> | s:<id> | d:<도메인>) — 지금 정상이면 "회복" */
    recentlyBad?: ReadonlySet<string>;
}

export interface SenderShare {
    profileId: number;
    final: number;
    failed: number;
    rateBp: number | null;
    shareBp: number;
}

export interface PartitionEval extends Tally {
    key: string;
    partitionId: number;
    workspaceId: number | null;
    name: string;
    state: HealthState;
    evalWindow: EvalWindow;
    final: number;
    failedCount: number;
    rateBp: number | null;
    unconfirmedBp: number;
    windowStart: Date;
    floorAt: Date | null;
    held: boolean;
    alertOnly: boolean;
    recovered: boolean;
    /** 이 명단을 보낸 주소들의 몫 (7일, 명단 하한 뒤) */
    senderShares: SenderShare[];
}

export interface CellEval {
    profileId: number;
    partitionId: number;
    final: number;
    failed: number;
    rateBp: number | null;
    restFinal: number;
    restFailed: number;
    restRateBp: number | null;
    pValue: number | null;
    eligible: boolean;
    outlier: boolean;
}

export interface SenderEval extends Tally {
    key: string;
    /** 0 = 프로필 없는 예전 기본 주소 */
    profileId: number;
    email: string;
    domain: string;
    isDefault: boolean;
    state: HealthState;
    final: number;
    failedCount: number;
    rateBp: number | null;
    unconfirmedBp: number;
    windowStart: Date;
    floorAt: Date | null;
    outlierCells: CellEval[];
    /**
     * 이 주소 자신의 실패율이 5% 이상인 칸 (칸 50통·실패 3통 이상, 명단 상태와 상관없이 — 보류·위험 명단 포함). PRD SND-3 "위험 — 주소:
     * 명단 2개 이상에서 함께 실패율 5% 이상"을 이것으로 본다 (F3): 이런 칸이 명단 2개 이상(확정 합 200통 이상)이고 주소 전체 실패율도
     * 5% 이상이면 위험. 실패율 높은 순
     */
    highCells: CellEval[];
    /** 위험이 된 까닭: outlier = 같은 명단 다른 주소보다 뚜렷이 높은 칸 2개 이상 · multi = 명단 2개 이상에서 함께 5% 이상 */
    dangerBy: "outlier" | "multi" | null;
    /** 판정한 칸 상위 10개 (p값 작은 순) */
    cells: CellEval[];
    /** 위험 명단 중 이 주소가 주된 발신(50%↑)인 명단 (SND-07) */
    primaryOfDanger: number[];
    workspaceIds: number[];
    autoPaused: boolean;
    recovered: boolean;
}

export interface DomainEval {
    key: string;
    domain: string;
    state: "ok" | "caution" | "danger";
    burst: boolean;
    final1h: number;
    senderSide1h: number;
    senderSide24h: number;
    final7d: number;
    failed7d: number;
    senderSide7d: number;
    rateBp7d: number | null;
    profileIds: number[];
    recovered: boolean;
}

export interface HealthEvaluation {
    partitions: PartitionEval[];
    senders: SenderEval[];
    domains: DomainEval[];
}

function unconfirmedBpOf(final: number, unknown: number): number {
    const all = final + unknown;
    return all > 0 ? Math.round((unknown * 10000) / all) : 0;
}

function stateFor(failed: number, final: number, t: HealthThresholds): HealthState {
    if (atLeastBp(failed, final, t.dangerRateBp)) return "danger";
    if (atLeastBp(failed, final, t.cautionRateBp)) return "caution";
    return "ok";
}

function later(a: Date, b: Date | null): Date {
    return b && b.getTime() > a.getTime() ? b : a;
}

/** 5절 전체. 명단 → 칸 → 주소 → 도메인 순서로 판정한다 */
export function evaluateHealth(input: EvaluateInput): HealthEvaluation {
    const t = input.thresholds ?? DEFAULT_THRESHOLDS;
    const now = input.now;
    const dsn = input.dsnInRate;
    const recentlyBad = input.recentlyBad ?? new Set<string>();
    const pInfo = new Map(input.partitions.map((p) => [p.id, p]));
    const sInfo = new Map(input.senders.map((s) => [s.id, s]));
    const sid = (b: { senderProfileId: number | null }) => b.senderProfileId ?? 0;

    // ── 명단 (5-3) ──
    const pTally = new Map<number, Tally>();
    const pBySender = new Map<number, Map<number, Tally>>();
    for (const b of input.buckets) {
        if (b.partitionId === null || !b.afterP) continue;
        addTally(pTally.get(b.partitionId) ?? pTally.set(b.partitionId, emptyTally()).get(b.partitionId)!, b);
        const bySender = pBySender.get(b.partitionId) ?? pBySender.set(b.partitionId, new Map()).get(b.partitionId)!;
        addTally(bySender.get(sid(b)) ?? bySender.set(sid(b), emptyTally()).get(sid(b))!, b);
    }
    const slowTally = new Map<number, Tally>();
    for (const r of input.slow) {
        if (!r.afterP) continue;
        const tl = slowTally.get(r.partitionId) ?? slowTally.set(r.partitionId, emptyTally()).get(r.partitionId)!;
        tl.success += r.success;
        tl.failed += r.failed;
        tl.dsnOnly += r.dsnOnly;
    }
    const partitionIds = new Set<number>([...pTally.keys(), ...input.partitions.map((p) => p.id)]);
    const partitions: PartitionEval[] = [];
    for (const id of partitionIds) {
        const info = pInfo.get(id);
        const tl = pTally.get(id) ?? emptyTally();
        if (!info && finalOf(tl, dsn) + tl.unknown + tl.senderSide + tl.nhnUnsub === 0) continue;
        const floorAt = info?.floorAt ?? null;
        let final = finalOf(tl, dsn);
        let failed = failedOf(tl, dsn);
        let evalWindow: EvalWindow = "7d";
        let windowStart = later(new Date(now.getTime() - t.windowMs), floorAt);
        let state: HealthState;
        if (final >= t.partitionMinFinal) {
            state = stateFor(failed, final, t);
        } else {
            const slow = slowTally.get(id);
            const sFinal = slow ? finalOf(slow, dsn) : 0;
            if (slow && sFinal >= t.partitionMinFinal) {
                final = sFinal;
                failed = failedOf(slow, dsn);
                evalWindow = "30d";
                windowStart = later(new Date(now.getTime() - t.slowWindowMs), floorAt);
                state = stateFor(failed, final, t);
            } else {
                state = "insufficient";
            }
        }
        const pFinal7 = finalOf(tl, dsn);
        const shares: SenderShare[] = [];
        for (const [s, st] of pBySender.get(id) ?? []) {
            const f = finalOf(st, dsn);
            if (f === 0) continue;
            const fl = failedOf(st, dsn);
            shares.push({ profileId: s, final: f, failed: fl, rateBp: rateBp(fl, f), shareBp: pFinal7 > 0 ? Math.round((f * 10000) / pFinal7) : 0 });
        }
        shares.sort((a, b) => b.final - a.final || a.profileId - b.profileId);
        partitions.push({
            ...tl,
            key: `p:${id}`,
            partitionId: id,
            workspaceId: info?.workspaceId ?? null,
            name: info?.name ?? `명단 ${id}`,
            state,
            evalWindow,
            final,
            failedCount: failed,
            rateBp: rateBp(failed, final),
            unconfirmedBp: unconfirmedBpOf(pFinal7, tl.unknown),
            windowStart,
            floorAt,
            held: (info?.activeHoldId ?? null) !== null,
            alertOnly: info?.alertOnly ?? false,
            recovered: state === "ok" && recentlyBad.has(`p:${id}`),
            senderShares: shares,
        });
    }
    partitions.sort((a, b) => a.partitionId - b.partitionId);

    // ── 칸에서 빼는 명단 (5-4) ──
    const excluded = new Set<number>();
    for (const p of partitions) {
        const info = pInfo.get(p.partitionId);
        if (p.state === "danger" || p.state === "caution") excluded.add(p.partitionId);
        else if (p.state === "insufficient" && atLeastBp(p.failedCount, p.final, t.cautionRateBp)) excluded.add(p.partitionId);
        if (info?.activeHoldId) excluded.add(p.partitionId);
        if (info?.heldOrReleasedRecently) excluded.add(p.partitionId);
    }

    // ── 칸 (주소 × 명단): 두 하한 뒤 발송만. 나머지 = 같은 명단의 다른 주소 (명단 하한 뒤) ──
    const cellTally = new Map<string, Tally>();
    for (const b of input.buckets) {
        if (b.partitionId === null || !b.afterP || !b.afterS) continue;
        const key = `${sid(b)}|${b.partitionId}`;
        addTally(cellTally.get(key) ?? cellTally.set(key, emptyTally()).get(key)!, b);
    }
    const cellsBySender = new Map<number, CellEval[]>();
    const highCellsBySender = new Map<number, CellEval[]>();
    for (const [key, ct] of cellTally) {
        const [sStr, pStr] = key.split("|");
        const s = Number(sStr);
        const p = Number(pStr);
        const pt = pTally.get(p) ?? emptyTally();
        const own = pBySender.get(p)?.get(s) ?? emptyTally();
        const restFinal = finalOf(pt, dsn) - finalOf(own, dsn);
        const restFailed = failedOf(pt, dsn) - failedOf(own, dsn);
        const final = finalOf(ct, dsn);
        const failed = failedOf(ct, dsn);
        // PRD 규칙의 칸 (F3): 이 주소 자신이 이 명단에서 5% 이상 — 명단이 위험·주의·보류여도 센다 (명단과 함께 높을 때 주소도 멈춘다)
        if (final >= t.pairMinFinal && failed >= t.pairMinFailed && atLeastBp(failed, final, t.dangerRateBp)) {
            const list = highCellsBySender.get(s) ?? highCellsBySender.set(s, []).get(s)!;
            list.push({
                profileId: s,
                partitionId: p,
                final,
                failed,
                rateBp: rateBp(failed, final),
                restFinal,
                restFailed,
                restRateBp: rateBp(restFailed, restFinal),
                pValue: null,
                eligible: false,
                outlier: false,
            });
        }
        if (excluded.has(p)) continue;
        const v = isOutlierCell({ final, failed, restFinal, restFailed }, t);
        const cell: CellEval = {
            profileId: s,
            partitionId: p,
            final,
            failed,
            rateBp: rateBp(failed, final),
            restFinal,
            restFailed,
            restRateBp: v.restRateBp,
            pValue: v.pValue,
            eligible: v.eligible,
            outlier: v.outlier,
        };
        const list = cellsBySender.get(s) ?? cellsBySender.set(s, []).get(s)!;
        list.push(cell);
    }

    // ── 주소 ──
    const sTally = new Map<number, Tally>();
    const sWorkspaces = new Map<number, Set<number>>();
    for (const b of input.buckets) {
        const s = sid(b);
        if (b.partitionId !== null) {
            const ws = pInfo.get(b.partitionId)?.workspaceId;
            if (ws) (sWorkspaces.get(s) ?? sWorkspaces.set(s, new Set()).get(s)!).add(ws);
        }
        if (!b.afterS) continue;
        addTally(sTally.get(s) ?? sTally.set(s, emptyTally()).get(s)!, b);
    }
    const senderIds = new Set<number>([...sTally.keys()]);
    const senders: SenderEval[] = [];
    for (const s of senderIds) {
        const info = sInfo.get(s);
        const tl = sTally.get(s) ?? emptyTally();
        const final = finalOf(tl, dsn);
        const failed = failedOf(tl, dsn);
        const cells = (cellsBySender.get(s) ?? []).slice();
        const outlierCells = cells.filter((c) => c.outlier);
        const eligibleCells = cells.filter((c) => c.eligible);
        const highCells = (highCellsBySender.get(s) ?? []).slice().sort((a, b) => (b.rateBp ?? 0) - (a.rateBp ?? 0) || a.partitionId - b.partitionId);
        const highFinal = highCells.reduce((a, c) => a + c.final, 0);
        // PRD "명단 2개 이상에서 함께 5% 이상" — 단, 이 주소의 전체 실패율도 5% 이상일 때만. 혼자 보내는 나쁜 명단 몇 개 때문에
        // 다른 명단에서는 멀쩡한 주소까지 멈추지 않게 한다 (그 명단들은 명단 보류로 막는다 — "명단 탓을 주소 탓으로 보지 않는다")
        const multiDanger =
            highCells.length >= t.senderDangerMinPartitions && highFinal >= t.senderMultiMinFinal && atLeastBp(failed, final, t.dangerRateBp);
        let state: HealthState;
        let dangerBy: SenderEval["dangerBy"] = null;
        if (outlierCells.length >= t.senderDangerMinPartitions) {
            state = "danger";
            dangerBy = "outlier";
        } else if (multiDanger) {
            // PRD SND-3 "위험 — 주소": 명단 2개 이상에서 함께 실패율 5% 이상 (F3, 대표 결정 2 "멈추고 알린다")
            state = "danger";
            dangerBy = "multi";
        } else if (outlierCells.length === 1 || (final >= t.senderCautionMinFinal && atLeastBp(failed, final, t.cautionRateBp))) state = "caution";
        else if (eligibleCells.length === 0 && final < t.senderCautionMinFinal) state = "insufficient";
        else state = "ok";
        const primaryOfDanger: number[] = [];
        for (const p of partitions) {
            if (p.state !== "danger") continue;
            const share = p.senderShares.find((x) => x.profileId === s);
            if (share && share.shareBp >= t.primarySenderShareBp) primaryOfDanger.push(p.partitionId);
        }
        cells.sort((a, b) => (a.pValue ?? 2) - (b.pValue ?? 2) || b.final - a.final);
        const floorAt = info?.floorAt ?? null;
        senders.push({
            ...tl,
            key: `s:${s}`,
            profileId: s,
            email: info?.email ?? "",
            domain: info?.domain ?? "",
            isDefault: info?.isDefault ?? false,
            state,
            final,
            failedCount: failed,
            rateBp: rateBp(failed, final),
            unconfirmedBp: unconfirmedBpOf(final, tl.unknown),
            windowStart: later(new Date(now.getTime() - t.windowMs), floorAt),
            floorAt,
            outlierCells,
            highCells,
            dangerBy,
            cells: cells.slice(0, 10),
            primaryOfDanger,
            workspaceIds: [...(sWorkspaces.get(s) ?? [])].sort((a, b) => a - b),
            autoPaused: !!info && info.isPaused && info.pausedSource === "auto",
            recovered: state === "ok" && recentlyBad.has(`s:${s}`),
        });
    }
    senders.sort((a, b) => a.profileId - b.profileId);

    // ── 도메인 (5-3 발신 쪽 실패) ──
    const dom = new Map<string, DomainEval>();
    const domOf = (d: string): DomainEval | null => {
        const key = (d ?? "").trim().toLowerCase();
        if (!key) return null;
        let e = dom.get(key);
        if (!e) {
            e = {
                key: `d:${key}`,
                domain: key,
                state: "ok",
                burst: false,
                final1h: 0,
                senderSide1h: 0,
                senderSide24h: 0,
                final7d: 0,
                failed7d: 0,
                senderSide7d: 0,
                rateBp7d: null,
                profileIds: [],
                recovered: false,
            };
            dom.set(key, e);
        }
        return e;
    };
    const since24h = now.getTime() - t.senderSideLookbackMs;
    for (const b of input.buckets) {
        const e = domOf(b.senderDomain);
        if (!e) continue;
        e.final7d += finalOf(b, dsn);
        e.failed7d += failedOf(b, dsn);
        e.senderSide7d += b.senderSide;
        if (b.hourStart.getTime() >= since24h - HOUR_MS + 1) e.senderSide24h += b.senderSide;
        if (b.senderProfileId !== null && !e.profileIds.includes(b.senderProfileId)) e.profileIds.push(b.senderProfileId);
    }
    for (const r of input.burst) {
        const e = domOf(r.senderDomain);
        if (!e) continue;
        e.final1h += finalOf(r, dsn);
        e.senderSide1h += r.senderSide;
        if (r.senderProfileId !== null && !e.profileIds.includes(r.senderProfileId)) e.profileIds.push(r.senderProfileId);
    }
    for (const s of input.senders) {
        const e = dom.get((s.domain ?? "").toLowerCase());
        if (e && !e.profileIds.includes(s.id)) e.profileIds.push(s.id);
    }
    const domains: DomainEval[] = [];
    for (const e of dom.values()) {
        e.burst = isAuthBurst(e.senderSide1h, e.final1h, t);
        e.state = e.burst ? "danger" : e.senderSide24h > 0 ? "caution" : "ok";
        e.rateBp7d = rateBp(e.failed7d, e.final7d);
        e.recovered = e.state === "ok" && recentlyBad.has(e.key);
        e.profileIds.sort((a, b) => a - b);
        domains.push(e);
    }
    domains.sort((a, b) => a.domain.localeCompare(b.domain));
    return { partitions, senders, domains };
}

/**
 * 발신 쪽 실패 폭주 (5-3, SND-06): 최근 1시간 발신 쪽 실패가 3통 이상이면서 (확정 + 발신 쪽 실패)의 20% 이상, 또는 10통 이상
 */
export function isAuthBurst(senderSide: number, final: number, t: HealthThresholds = DEFAULT_THRESHOLDS): boolean {
    if (senderSide >= t.authBurstHardCount) return true;
    return senderSide >= t.authBurstMinCount && senderSide * 10000 >= (final + senderSide) * t.authBurstMinRateBp;
}

// ============================================
// 동기화 건강 관문 (6-1)
// ============================================

export type ActionNote =
    | "mode"
    | "opt_out"
    | "cap"
    | "cap_auth"
    | "no_profile"
    | "already"
    | "default_sender"
    | "sync_stale"
    | "sync_initial"
    | "unconfirmed_high";

export interface SyncStateLike {
    lastOkAt: Date | null;
    lastErrorCode: string | null;
    initialDoneAt: Date | null;
}

/**
 * 조직 단위 관문: 동기화 정체(마지막 성공이 30분보다 오래됨 또는 키 오류) → sync_stale, 처음 채우기 중 → sync_initial.
 * 동기화 상태가 아직 없으면(한 번도 안 돎) 처음 채우기 중으로 본다. 걸리면 enforce여도 보류·멈춤 없이 알림만 한다.
 */
export function syncGate(state: SyncStateLike | null, now: Date, t: HealthThresholds = DEFAULT_THRESHOLDS): "sync_stale" | "sync_initial" | null {
    if (!state) return "sync_initial";
    if (state.lastErrorCode === "auth") return "sync_stale";
    if (!state.lastOkAt || now.getTime() - state.lastOkAt.getTime() > t.syncStaleMs) return "sync_stale";
    if (!state.initialDoneAt) return "sync_initial";
    return null;
}

// ============================================
// 사건 키 (7-1)
// ============================================

/** 비율 1%p 칸 = floor(rate_bp / 100). 이어지는 위험은 상태가 바뀌거나 1%p 넘게 나빠질 때만 새 사건이 된다 (SND-13) */
export function rateBucket(bp: number | null): number {
    return bp === null ? 0 : Math.floor(bp / 100);
}

function floorMs(d: Date | null): number {
    return d ? d.getTime() : 0;
}

/** 한 대상의 위험 구간 (F7·OPS-4): 구간 시작 시각과 이미 남긴 위험 사건 키들 */
export interface DangerEpisode {
    startedAt: Date | null;
    existingKeys: ReadonlySet<string>;
}

/** 대상의 지난 회차 기록 (email_health_daily 가장 최근 줄): 상태·위험 구간 시작·마지막으로 위험이었던 때 */
export interface DangerEpisodeState {
    state: string | null;
    episodeAt: Date | null;
    lastDangerAt: Date | null;
}

/**
 * 이번 회차 위험의 구간 시작 (F7·OPS-4, DESIGN-SND 7-1 "상태가 바뀌거나 풀린 뒤 다시"). 지난 회차도 위험이었거나 위험에서 벗어난 지
 * dangerEpisodeGapMs(24시간)가 안 됐으면 같은 구간, 아니면 지금부터 새 구간 — 새 구간이면 바로 알림이 다시 간다.
 * alert·dry_run 모드나 알림만 대상은 보류·멈춤이 없어 하한이 움직이지 않는다 — 구간이 없으면 회복 뒤 다시 위험해져도 알림이 없었다
 */
export function dangerEpisodeStart(prev: DangerEpisodeState | null, now: Date, t: HealthThresholds = DEFAULT_THRESHOLDS): Date {
    if (prev?.episodeAt) {
        if (prev.state === "danger") return prev.episodeAt;
        if (prev.lastDangerAt && now.getTime() - prev.lastDangerAt.getTime() < t.dangerEpisodeGapMs) return prev.episodeAt;
    }
    return now;
}

/**
 * 위험 사건 키: danger:<p|s>:<id>:<모드>:<하한 ms>:e<구간 시작 ms>:<1%p 칸>. 같은 구간 안에서는 이미 알린 가장 높은 칸보다
 * 나빠졌을 때만 새 키(= 새 사건·알림)가 되고, 좋아지거나 같으면 이미 있는 가장 높은 칸의 키를 돌려준다 (좋아질 때 다시 알리지 않는다).
 * <하한 ms>는 그 대상의 재판정 유예 하한(명단 released_at, 주소 health_reset_at)이고 없으면 0. 날짜는 넣지 않는다.
 * 모드가 키에 있어 dry_run 사건이 있어도 enforce로 바꾸면 새로 조치하고 알린다.
 */
function dangerKeyInfo(
    kind: "p" | "s",
    id: number,
    mode: SendHealthMode,
    floor: Date | null,
    bp: number | null,
    episode?: DangerEpisode | null
): { key: string; prevBucket: number | null } {
    const prefix = `danger:${kind}:${id}:${mode}:${floorMs(floor)}:e${episode?.startedAt ? episode.startedAt.getTime() : 0}:`;
    const bucket = rateBucket(bp);
    let maxAlerted = -1;
    for (const k of episode?.existingKeys ?? []) {
        if (!k.startsWith(prefix)) continue;
        const b = Number(k.slice(prefix.length));
        if (Number.isInteger(b) && b > maxAlerted) maxAlerted = b;
    }
    return { key: `${prefix}${maxAlerted >= bucket ? maxAlerted : bucket}`, prevBucket: maxAlerted >= 0 ? maxAlerted : null };
}

function dangerKey(kind: "p" | "s", id: number, mode: SendHealthMode, floor: Date | null, bp: number | null, episode?: DangerEpisode | null): string {
    return dangerKeyInfo(kind, id, mode, floor, bp, episode).key;
}

/** 같은 위험 구간에서 이미 알린 칸보다 나빠져 다시 알리는 것이면 그 지난 칸 (1%p 칸 = "6%대"), 처음이면 null (HB-8) */
function worsenedFrom(kind: "p" | "s", id: number, mode: SendHealthMode, floor: Date | null, bp: number | null, episode?: DangerEpisode | null): number | null {
    const info = dangerKeyInfo(kind, id, mode, floor, bp, episode);
    return info.prevBucket !== null && rateBucket(bp) > info.prevBucket ? info.prevBucket : null;
}

/**
 * 사건 키 (7-1). 위험 사건은 dangerKey (구간·칸). 날짜를 키에 넣지 않는다 (이어지는 위험이 매일 0시 직후 다시 오지 않게).
 */
export const dedupeKey = {
    partitionDanger: (partitionId: number, mode: SendHealthMode, floor: Date | null, bp: number | null, episode?: DangerEpisode | null) =>
        dangerKey("p", partitionId, mode, floor, bp, episode),
    senderDanger: (profileId: number, mode: SendHealthMode, floor: Date | null, bp: number | null, episode?: DangerEpisode | null) =>
        dangerKey("s", profileId, mode, floor, bp, episode),
    senderWith: (profileId: number, mode: SendHealthMode, partitionIds: readonly number[]) => {
        const ids = [...partitionIds].sort((a, b) => a - b);
        const head = ids.slice(0, 10).join(",");
        return `danger_with:s:${profileId}:${mode}:${head}${ids.length > 10 ? `+${ids.length - 10}` : ""}`;
    },
    authBurst: (domain: string, mode: SendHealthMode, now: Date) => `auth_burst:d:${domain}:${mode}:${kstParts(now).date}`.slice(0, 200),
    /**
     * NHN 결과 확인 알림 한 통 (원인·모드 갈래·보낸 때). 달력 6시간 칸이 아니라 "마지막 알림 6시간 뒤"로 다시 알린다 —
     * 칸 경계에서 2분 사이 두 통·같은 칸 안의 두 번째 장애 놓침이 없게 (HS-1·HS-6). 시험 모드(dry_run)는 갈래가 다르다 (HS-4)
     */
    syncAlert: (cause: string, mode: SendHealthMode, at: Date) => `sync:${cause}:${mode === "dry_run" ? "dry" : "live"}:${at.getTime()}`,
    /** 회복 글 한 통 — 알린 장애 구간(원인·알린 때)마다. 같은 때 알린 다른 원인의 구간과 겹치지 않게 원인을 넣는다 */
    syncRecovered: (alertedAt: Date, cause?: string | null) => `sync:recovered:${cause ? `${cause}:` : ""}${alertedAt.getTime()}`,
    releaseHold: (holdId: number) => `release:hold:${holdId}`,
    releaseSender: (profileId: number, releasedAt: Date) => `release:s:${profileId}:${releasedAt.getTime()}`,
    cap: (now: Date) => `cap:${kstParts(now).date}`,
    capAuth: (now: Date) => `cap_auth:${kstParts(now).date}`,
    /** 매일 보고. 시험 모드(dry_run) 보고는 따로 — dry_run에서 alert로 바꾼 날에도 보고가 나가게 (HD-11) */
    report: (now: Date, mode?: SendHealthMode) => `report:${kstParts(now).date}${mode === "dry_run" ? ":dry" : ""}`,
};

/**
 * 구글 챗 스레드 키 (GOOGLE_CHAT_THREADS=on일 때만 쓴다). 매일 보고는 조직·받는 곳마다 한 스레드에 이어 달고,
 * NHN 결과 확인 알림(정체·키 오류·회복)은 조직마다 한 스레드로 모은다 (HD-14·HB-8). 회차 묶음·풀림은 여러 명단이 섞여 새 스레드
 */
export function healthThreadKey(batchKey: string, orgId: string, target: string): string | undefined {
    const org = orgId.replace(/[^0-9a-f]/gi, "").slice(0, 8).toLowerCase();
    const to = target.replace(/[^0-9a-z]/gi, "").toLowerCase();
    if (batchKey.startsWith("report:")) return `health-report-${org}-${to}`;
    if (batchKey.startsWith("sync:")) return `health-sync-${org}`;
    return undefined;
}

/** KST 22~08시 */
export function isQuietHour(now: Date): boolean {
    const h = kstParts(now).hour;
    return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

/** 매일 보고를 낼 때인가: KST reportHour 시 이후 (그날 보고가 아직 없으면 — DB가 dedupe로 본다) */
export function isReportDue(now: Date, reportHour: number): boolean {
    return kstParts(now).hour >= reportHour;
}

// ============================================
// 조치 계획 (6절)
// ============================================

export interface PlannedEvent {
    kind: "danger" | "danger_with" | "auth_burst";
    entityType: "partition" | "sender" | "domain";
    entityId: number | null;
    entityKey: string | null;
    /** 알림을 받을 사업 스페이스 (운영 스페이스는 늘 받는다) */
    workspaceIds: number[];
    dedupeKey: string;
    action: "none" | "hold" | "pause";
    actionNote: ActionNote | null;
    /** dry_run·alert·관문·예외로 하지 않은 조치 — 사건에 "했을 조치"로 남긴다 */
    wouldAction: "hold" | "pause" | null;
    evalWindow: EvalWindow | null;
    /** pause: 멈출 주소들 (주소 위험은 하나, 발신 쪽 실패 폭주는 그 도메인의 멈출 수 있는 주소들) */
    pauseProfileIds: number[];
    /** 발신 쪽 실패 폭주에서 멈추지 않은 주소 (기본 주소·알림만·이미 멈춤) */
    skippedProfileIds: number[];
    /** 밤에도 보낼 사건 (조치·폭주) */
    urgent: boolean;
    /** 같은 위험 구간에서 더 나빠져 다시 알리는 것이면 지난 알림의 1%p 칸 (HB-8) */
    worsenedFromBucket?: number | null;
}

export interface PlanInput {
    mode: SendHealthMode;
    now: Date;
    evaluation: HealthEvaluation;
    senders: readonly HealthSenderInfo[];
    /** 조직 단위 동기화 관문 (syncGate) */
    gate: "sync_stale" | "sync_initial" | null;
    /** 오늘(KST) 남은 자동 멈춤 수 (주소 위험) */
    autoPauseLeft: number;
    /** 오늘(KST) 남은 발신 쪽 실패 폭주 멈춤 도메인 수 */
    authDomainsLeft: number;
    thresholds?: HealthThresholds;
    /** 대상별 위험 구간 시작 (dangerEpisodeStart) — 없으면 구간 없음(e0) */
    episodes?: { partitions: ReadonlyMap<number, Date>; senders: ReadonlyMap<number, Date> };
    /** 이 조직이 이미 남긴 위험 사건 키 (최근 것) — 같은 구간 안에서 이미 알린 칸을 찾는다 */
    existingDangerKeys?: ReadonlySet<string>;
}

export interface PlanResult {
    events: PlannedEvent[];
    /** 상한에 걸려 멈추지 않은 주소 id (cap 사건 한 덩어리) */
    cappedSenders: number[];
    /** 상한에 걸려 멈추지 않은 도메인 (cap_auth) */
    cappedDomains: string[];
}

/**
 * 판정 결과 → 사건과 조치 (6-1~6-4). 순수: 모드·관문·예외·상한·기본 주소만 본다. 실제 보류·멈춤·사건 쓰기는 sender-health.ts.
 *   - 보류 중인 명단·자동 멈춘 주소는 다시 판정하지 않는다 (같은 사건이 거듭 생기지 않게)
 *   - 명단 위험 → 보류 (대량만), 주소 위험(뚜렷이 높은 칸 2개 또는 명단 2개 이상에서 함께 5%↑, F3) → 멈춤
 *     (기본 주소·알림만 주소·프로필 없음은 알림만). 주소 자신은 위험이 아닌데 위험 명단 2개의 주된 발신이면 → 알림만 (SND-07)
 *   - 발신 쪽 실패 폭주 → 그 도메인 주소 멈춤 (미확정 관문은 보지 않는다 — 확정된 것만 센다)
 */
export function planActions(input: PlanInput): PlanResult {
    const t = input.thresholds ?? DEFAULT_THRESHOLDS;
    const { mode, now, evaluation, gate } = input;
    const enforce = mode === "enforce";
    const sInfo = new Map(input.senders.map((s) => [s.id, s]));
    const events: PlannedEvent[] = [];
    const cappedSenders: number[] = [];
    const cappedDomains: string[] = [];
    let pauseLeft = Math.max(0, input.autoPauseLeft);
    let domainsLeft = Math.max(0, input.authDomainsLeft);

    for (const p of evaluation.partitions) {
        if (p.state !== "danger" || p.held) continue;
        let action: PlannedEvent["action"] = "none";
        let note: ActionNote | null = null;
        if (!enforce) note = "mode";
        else if (p.alertOnly) note = "opt_out";
        else if (gate) note = gate;
        else if (p.unconfirmedBp > t.maxUnconfirmedBp) note = "unconfirmed_high";
        else action = "hold";
        events.push({
            kind: "danger",
            entityType: "partition",
            entityId: p.partitionId,
            entityKey: null,
            workspaceIds: p.workspaceId ? [p.workspaceId] : [],
            dedupeKey: dedupeKey.partitionDanger(p.partitionId, mode, p.floorAt, p.rateBp, {
                startedAt: input.episodes?.partitions.get(p.partitionId) ?? null,
                existingKeys: input.existingDangerKeys ?? new Set(),
            }),
            action,
            actionNote: note,
            wouldAction: action === "none" ? "hold" : null,
            evalWindow: p.evalWindow,
            pauseProfileIds: [],
            skippedProfileIds: [],
            urgent: action !== "none",
            worsenedFromBucket: worsenedFrom("p", p.partitionId, mode, p.floorAt, p.rateBp, {
                startedAt: input.episodes?.partitions.get(p.partitionId) ?? null,
                existingKeys: input.existingDangerKeys ?? new Set(),
            }),
        });
    }

    for (const s of evaluation.senders) {
        if (s.state !== "danger" || s.autoPaused) continue;
        const info = s.profileId > 0 ? sInfo.get(s.profileId) : undefined;
        let action: PlannedEvent["action"] = "none";
        let note: ActionNote | null = null;
        if (!enforce) note = "mode";
        else if (!info) note = "no_profile";
        else if (info.isDefault) note = "default_sender";
        else if (info.isPaused) note = "already";
        else if (info.healthAction === "alert") note = "opt_out";
        else if (gate) note = gate;
        else if (s.unconfirmedBp > t.maxUnconfirmedBp) note = "unconfirmed_high";
        else if (pauseLeft <= 0) {
            note = "cap";
            cappedSenders.push(s.profileId);
        } else {
            action = "pause";
            pauseLeft--;
        }
        events.push({
            kind: "danger",
            entityType: "sender",
            entityId: s.profileId,
            entityKey: s.email || null,
            workspaceIds: s.workspaceIds,
            dedupeKey: dedupeKey.senderDanger(s.profileId, mode, s.floorAt, s.rateBp, {
                startedAt: input.episodes?.senders.get(s.profileId) ?? null,
                existingKeys: input.existingDangerKeys ?? new Set(),
            }),
            action,
            actionNote: note,
            wouldAction: action === "none" ? "pause" : null,
            evalWindow: "7d",
            pauseProfileIds: action === "pause" ? [s.profileId] : [],
            skippedProfileIds: [],
            urgent: action !== "none",
            worsenedFromBucket: worsenedFrom("s", s.profileId, mode, s.floorAt, s.rateBp, {
                startedAt: input.episodes?.senders.get(s.profileId) ?? null,
                existingKeys: input.existingDangerKeys ?? new Set(),
            }),
        });
    }

    for (const s of evaluation.senders) {
        if (s.primaryOfDanger.length < t.senderDangerMinPartitions) continue;
        // 주소 자신이 위험이면 위 주소 위험 사건(멈춤 포함)이 이미 알린다 — 같은 일을 두 번 알리지 않는다
        if (s.state === "danger") continue;
        const ws = new Set<number>();
        for (const pid of s.primaryOfDanger) {
            const p = evaluation.partitions.find((x) => x.partitionId === pid);
            if (p?.workspaceId) ws.add(p.workspaceId);
        }
        events.push({
            kind: "danger_with",
            entityType: "sender",
            entityId: s.profileId,
            entityKey: s.email || null,
            workspaceIds: [...ws].sort((a, b) => a - b),
            dedupeKey: dedupeKey.senderWith(s.profileId, mode, s.primaryOfDanger),
            action: "none",
            actionNote: null,
            wouldAction: null,
            evalWindow: "7d",
            pauseProfileIds: [],
            skippedProfileIds: [],
            urgent: false,
        });
    }

    for (const d of evaluation.domains) {
        if (!d.burst) continue;
        const candidates = d.profileIds.map((id) => sInfo.get(id)).filter((x): x is HealthSenderInfo => !!x);
        const pausable = candidates.filter((x) => !x.isDefault && !x.isPaused && x.healthAction !== "alert").map((x) => x.id);
        const skipped = candidates.filter((x) => !pausable.includes(x.id)).map((x) => x.id);
        let action: PlannedEvent["action"] = "none";
        let note: ActionNote | null = null;
        if (!enforce) note = "mode";
        // 폭주는 NHN이 확정한 것만 세므로 "미확정이 많음"은 보지 않는다 (6-1)
        else if (gate) note = gate;
        else if (pausable.length === 0) note = candidates.some((x) => x.isDefault) ? "default_sender" : "no_profile";
        else if (domainsLeft <= 0) {
            note = "cap_auth";
            cappedDomains.push(d.domain);
        } else {
            action = "pause";
            domainsLeft--;
        }
        // 그 도메인 주소를 쓰는 사업 스페이스에도 알린다 — 발송이 왜 줄었는지 사업 담당이 알게 (HB-13, 설계 7-2)
        const burstWs = new Set<number>();
        for (const sv of evaluation.senders) if (d.profileIds.includes(sv.profileId)) for (const w of sv.workspaceIds) burstWs.add(w);
        events.push({
            kind: "auth_burst",
            entityType: "domain",
            entityId: null,
            entityKey: d.domain,
            workspaceIds: [...burstWs].sort((a, b) => a - b),
            dedupeKey: dedupeKey.authBurst(d.domain, mode, now),
            action,
            actionNote: note,
            wouldAction: action === "none" && pausable.length > 0 ? "pause" : null,
            evalWindow: null,
            pauseProfileIds: action === "pause" ? pausable : [],
            skippedProfileIds: skipped,
            urgent: true,
        });
    }

    return { events, cappedSenders, cappedDomains };
}

// ============================================
// 글 (7-3) — 받는 사람 주소·이름·본문을 넣지 않는다. 명단 이름·우리 발신 주소·숫자·사유 코드 이름만
// ============================================

export interface FailReason {
    status: string | null;
    count: number;
}

/** 사유 코드 → "받는 주소 없음 (5.1.1)" (풀이가 먼저, 코드는 괄호, HB-11) */
function reasonLabel(status: string | null): string {
    if (!status) return "사유 코드 없음";
    const label = dsnLabel(status);
    return label.startsWith(`${status} `) ? `${label.slice(status.length + 1)} (${status})` : label;
}

function reasonsLine(reasons: readonly FailReason[]): string {
    if (reasons.length === 0) return "";
    const top = reasons.slice(0, 3).map((r) => `${reasonLabel(r.status)} ${r.count}통`);
    const rest = reasons.slice(3).reduce((a, r) => a + r.count, 0);
    return `실패 이유: ${top.join(" · ")}${rest > 0 ? ` · 기타 ${rest}통` : ""}`;
}

function windowLabel(w: EvalWindow | null): string {
    return w === "30d" ? "최근 30일(느린 명단)" : "최근 7일";
}

function noteLine(note: ActionNote | null, mode: SendHealthMode): string {
    switch (note) {
        case "mode":
            return mode === "dry_run"
                ? "조치: 없음 — 기록만 하는 시험 단계라 알림·자동 멈춤이 꺼져 있습니다"
                : "조치: 없음 — 지금은 알림만 보내는 단계라 자동 멈춤은 꺼져 있습니다";
        case "opt_out":
            return "조치: 없음 — 알림만 하도록 정한 대상입니다";
        case "cap":
            return "조치: 없음 — 오늘 자동 멈춤 상한에 걸려 멈추지 않았습니다. 확인이 필요합니다.";
        case "cap_auth":
            return "조치: 없음 — 오늘 도메인 멈춤 상한에 걸려 나머지 도메인은 알림만 합니다.";
        case "no_profile":
            return "조치: 없음 — 멈출 수 있는 발신 주소 설정이 없습니다.";
        case "already":
            return "조치: 없음 — 이미 손으로 멈춘 주소입니다.";
        case "default_sender":
            return "조치: 없음 — 이 주소는 조직 기본 주소입니다. 멈추면 이 조직의 템플릿 메일(폼 문의 첫 메일 포함)이 모두 멈춥니다. 확인 뒤 발신 주소 설정에서 멈추거나 기본 주소를 바꿔 주세요.";
        case "sync_stale":
            return "조치: 없음 — NHN 결과 확인이 멈춰 있어 자동 조치를 미뤘습니다.";
        case "sync_initial":
            return "조치: 없음 — NHN 결과를 처음 채우는 중이라 자동 조치를 미뤘습니다.";
        case "unconfirmed_high":
            return "조치: 없음 — NHN 결과가 아직 오지 않은 메일이 많아(20% 넘음) 자동 조치를 미뤘습니다.";
        default:
            return "";
    }
}

/** "— 더 나빠짐 (지난 알림 6%대 → 지금 7.7%)" (HB-8) */
function worseText(prevBucket: number | null | undefined, bp: number | null): string {
    return prevBucket === null || prevBucket === undefined ? "" : ` — 더 나빠짐 (지난 알림 ${prevBucket}%대 → 지금 ${formatRate(bp)})`;
}

export interface PartitionDangerTextInput {
    p: PartitionEval;
    workspaceName: string | null;
    mode: SendHealthMode;
    action: "none" | "hold";
    actionNote: ActionNote | null;
    reasons: readonly FailReason[];
    /** 보류로 남겨 둔 대기 수 */
    heldQueue: number | null;
    /** 이 명단을 보낸 주소의 실패율 (주소 이메일 포함) */
    senderRates: ReadonlyArray<{ email: string; rateBp: number | null; final: number }>;
    baseUrl: string;
    /** 같은 위험 구간에서 더 나빠져 다시 알리는 것이면 지난 알림의 1%p 칸 (HB-8) */
    worsenedFromBucket?: number | null;
}

export function partitionDangerText(x: PartitionDangerTextInput): string {
    const p = x.p;
    const head = x.action === "hold" ? "[발송 위험 · 명단 보류]" : "[발송 위험 · 명단]";
    const lines = [
        `${head} ${x.workspaceName ? `${u(x.workspaceName)} › ` : ""}${u(p.name)}${worseText(x.worsenedFromBucket, p.rateBp)}`,
        `${windowLabel(p.evalWindow)} 결과가 나온 ${p.final.toLocaleString("ko-KR")}통 중 실패 ${p.failedCount}통 (${formatRate(p.rateBp)}) — 200통 넘게 보냈을 때 실패가 5%를 넘으면 위험으로 봅니다`,
    ];
    const r = reasonsLine(x.reasons);
    if (r) lines.push(r);
    if (x.action === "hold") {
        const q = x.heldQueue ? ` 대기 ${x.heldQueue.toLocaleString("ko-KR")}통은 지우지 않고 남겨 두었습니다.` : "";
        lines.push(`조치: 이 명단의 대량 발송(가져온 명단 첫 메일·후속·템플릿 반복)을 멈췄습니다.${q} 폼·광고 문의 메일은 그대로 나갑니다.`);
    } else {
        lines.push(noteLine(x.actionNote, x.mode));
    }
    const rates = x.senderRates.filter((s) => s.final > 0 && s.rateBp !== null);
    if (rates.length >= 2) {
        const bps = rates.map((s) => s.rateBp as number);
        const min = Math.min(...bps);
        const max = Math.max(...bps);
        const similar = max - min <= 300;
        const range = min === max ? `모두 ${formatRate(min)}` : `${formatRate(min)}~${formatRate(max)}`;
        lines.push(
            `이 명단을 보낸 주소 ${rates.length}개의 실패율은 ${range}${similar ? "로 비슷합니다 — 명단 쪽 문제로 보입니다." : "로 차이가 납니다 — 주소 쪽도 확인해 주세요."}`
        );
    } else if (rates.length === 1) {
        lines.push(`이 명단은 사실상 한 주소(${u(rates[0].email)})로 보냈습니다 — 주소 문제일 수도 있습니다.`);
    }
    if (p.dsnOnly > 0) lines.push(`반송 안내(참고, 실패율에는 아직 안 넣음): ${p.dsnOnly}통`);
    if (x.action === "hold") lines.push(`풀기(관리자): ${x.baseUrl}/email#send-health`);
    return lines.filter(Boolean).join("\n");
}

/**
 * 사업 스페이스로 보낼 글의 범위 (RH-SEC-4). 발신 주소는 조직 단위라 여러 사업 명단을 보낸다 — 사업 스페이스 글에는 그 사업 명단의
 * 이름·실패율만 싣고 다른 사업 명단은 "다른 사업 명단 N개"로 숫자만. 운영 스페이스 글(null)은 전부.
 */
export interface WorkspaceTextScope {
    workspaceId: number;
    partitionWorkspace: ReadonlyMap<number, number>;
}

export interface SenderDangerTextInput {
    s: SenderEval;
    mode: SendHealthMode;
    action: "none" | "pause";
    actionNote: ActionNote | null;
    partitionNames: ReadonlyMap<number, string>;
    /** 이 주소를 쓰는 AI 규칙 묶음 (이름, 묶음 주소 수, 규칙 명단의 워크스페이스) */
    rulePools: ReadonlyArray<{ name: string; size: number; workspaceId?: number | null }>;
    /** 같은 위험 구간에서 더 나빠져 다시 알리는 것이면 지난 알림의 1%p 칸 (HB-8) */
    worsenedFromBucket?: number | null;
    warmup: boolean;
    baseUrl: string;
    scope?: WorkspaceTextScope | null;
}

function inTextScope(scope: WorkspaceTextScope | null | undefined, partitionId: number): boolean {
    return !scope || scope.partitionWorkspace.get(partitionId) === scope.workspaceId;
}

export function senderDangerText(x: SenderDangerTextInput): string {
    const s = x.s;
    const head = x.action === "pause" ? "[발송 위험 · 주소 멈춤]" : "[발송 위험 · 주소]";
    const name = (pid: number) => u(x.partitionNames.get(pid) ?? `명단 ${pid}`);
    const multi = s.dangerBy === "multi";
    const list = multi ? s.highCells : s.outlierCells;
    const shown = list.filter((c) => inTextScope(x.scope, c.partitionId));
    const hidden = list.length - shown.length;
    const cells = [
        shown.map((c) => `${name(c.partitionId)} ${formatRate(c.rateBp)} (결과 ${c.final}통 중 실패 ${c.failed}통)`).join(" · "),
        hidden > 0 ? `다른 사업 명단 ${hidden}개` : "",
    ]
        .filter(Boolean)
        .join(" · ");
    const lines = [`${head} ${u(s.email) || "기본 발신 주소(설정 없음)"}${worseText(x.worsenedFromBucket, s.rateBp)}`];
    if (multi) {
        lines.push(`명단 ${list.length}개에서 함께 실패율 5% 이상: ${cells}`);
        lines.push("여러 명단에서 함께 높습니다 — 이 주소 쪽 문제(발신 인증·평판)일 수 있습니다.");
    } else {
        const rests = shown.map((c) => formatRate(c.restRateBp)).join("·");
        lines.push(`명단 ${list.length}개에서 같은 명단의 다른 주소보다 뚜렷이 높음: ${cells}`);
        lines.push(
            rests
                ? `같은 명단의 다른 주소는 ${rests} — 이 주소 쪽 문제(발신 인증·평판)일 수 있습니다.`
                : "같은 명단의 다른 주소보다 뚜렷이 높습니다 — 이 주소 쪽 문제(발신 인증·평판)일 수 있습니다."
        );
    }
    if (x.action === "pause") {
        const parts = ["조치: 이 주소를 멈췄습니다."];
        // 사업 스페이스 글에는 그 사업 규칙 이름만, 다른 사업 규칙은 수만 (RH-SEC-4, HB-5)
        const pools = x.scope ? x.rulePools.filter((r) => r.workspaceId === x.scope!.workspaceId) : x.rulePools;
        for (const r of pools) parts.push(`규칙 "${u(r.name, 40)}"은 묶음 ${r.size}개 중 ${Math.max(0, r.size - 1)}개로 계속 보냅니다.`);
        const otherRules = x.rulePools.length - pools.length;
        if (otherRules > 0) parts.push(`다른 사업 규칙 ${otherRules}개도 묶음의 남은 주소로 계속 보냅니다.`);
        if (x.warmup) parts.push("웜업 중이면 풀 때 멈춘 날의 한도로 다시 시작합니다.");
        lines.push(parts.join(" "));
        lines.push(`풀기(관리자): ${x.baseUrl}/email#send-health`);
    } else {
        lines.push(noteLine(x.actionNote, x.mode));
    }
    return lines.filter(Boolean).join("\n");
}

export function senderWithPartitionsText(x: {
    s: SenderEval;
    partitions: ReadonlyArray<{ partitionId: number; name: string; rateBp: number | null; shareBp: number }>;
    held: boolean;
    scope?: WorkspaceTextScope | null;
}): string {
    const shown = x.partitions.filter((p) => inTextScope(x.scope, p.partitionId));
    const hidden = x.partitions.length - shown.length;
    const items = [
        shown.map((p) => `${u(p.name)} ${formatRate(p.rateBp)} (이 주소가 ${Math.round(p.shareBp / 100)}%)`).join(" · "),
        hidden > 0 ? `다른 사업 명단 ${hidden}개` : "",
    ]
        .filter(Boolean)
        .join(" · ");
    // 실제 비율을 그대로 쓴다 — "사실상 하나"는 50~99%에서 앞 블록과 맞지 않았다 (HB-10)
    const shares = x.partitions.map((p) => Math.round(p.shareBp / 100));
    const minShare = Math.min(...shares);
    const maxShare = Math.max(...shares);
    const share = shares.length === 0 ? "" : minShare === maxShare ? `${minShare}%` : `${minShare}~${maxShare}%`;
    const n = x.partitions.length;
    return [
        `[발송 위험 · 주소] ${u(x.s.email) || "기본 발신 주소(설정 없음)"} — 위험 명단 ${n}개를 주로 보낸 주소`,
        items,
        `${x.held ? `위험 명단 ${n}개는 보류되어 발송은 멈췄습니다. ` : ""}위험 명단 발송의 ${share}를 이 주소가 보냈습니다 — 주소 쪽 문제일 수 있습니다. 확인 뒤 필요하면 발신 주소 설정에서 멈춰 주세요.`,
    ].join("\n");
}

export function authBurstText(x: {
    d: DomainEval;
    mode: SendHealthMode;
    action: "none" | "pause";
    actionNote: ActionNote | null;
    reasons: readonly FailReason[];
    pausedEmails: readonly string[];
    skippedEmails: readonly string[];
    defaultEmails: readonly string[];
}): string {
    const d = x.d;
    const all = d.final1h + d.senderSide1h;
    const lines = [
        `[발송 위험 · 발신 인증] ${u(d.domain)} — 최근 1시간 발신 인증 실패 ${d.senderSide1h}통 (발송 ${all}통 중 ${formatRate(rateBp(d.senderSide1h, all))})`,
    ];
    if (x.reasons.length > 0) {
        const r = x.reasons.slice(0, 3).map((q) => `${reasonLabel(q.status)} ${q.count}통`).join(" · ");
        lines.push(`이유: ${r} — 도메인 SPF·DKIM·DMARC 설정을 확인해 주세요.`);
    } else {
        lines.push("도메인 SPF·DKIM·DMARC 설정을 확인해 주세요.");
    }
    if (x.action === "pause") {
        const def = x.defaultEmails.length > 0 ? ` (기본 주소 ${x.defaultEmails.map((e) => u(e)).join(", ")}은 알림만)` : "";
        lines.push(`조치: 이 도메인 주소 ${x.pausedEmails.length}개를 멈췄습니다${def}. 명단 실패율에는 넣지 않았습니다.`);
    } else {
        lines.push(noteLine(x.actionNote, x.mode) || "조치: 없음");
        lines.push("명단 실패율에는 넣지 않았습니다.");
    }
    return lines.filter(Boolean).join("\n");
}

/** 앞 10개까지 보이고 "외 N개" (HB-4) */
function listCapped(items: readonly string[], max = 10): string {
    const shown = items.slice(0, max).map((x) => u(x));
    return `${shown.join(", ")}${items.length > max ? ` 외 ${items.length - max}개` : ""}`;
}

export function capText(x: { senderEmails: readonly string[]; domains: readonly string[]; maxPause: number; maxDomains: number }): string {
    const lines: string[] = [];
    if (x.senderEmails.length > 0) {
        lines.push(
            `[발송 위험 · 상한] 오늘 자동 멈춤 상한(${x.maxPause}개)에 걸려 멈추지 않은 주소 ${x.senderEmails.length}개: ${listCapped(x.senderEmails)}`,
            "여러 주소가 한꺼번에 나빠지면 주소보다 NHN·명단 쪽 문제일 가능성이 큽니다 — 확인이 필요합니다."
        );
    }
    if (x.domains.length > 0) {
        lines.push(`[발송 위험 · 상한] 오늘 도메인 멈춤 상한(${x.maxDomains}개)을 넘은 도메인 ${x.domains.length}개는 알림만: ${listCapped(x.domains)}`);
    }
    return lines.join("\n");
}

export function releaseText(x: {
    kind: "hold" | "sender";
    name: string;
    actorName: string | null;
    /** 사람이 쓴 메모 */
    note: string | null;
    /** 사람이 쓴 메모가 아니라 풀린 경로 (발신 주소 설정에서 정지를 끔, HR-9) */
    via?: "settings" | null;
    revived?: number;
    todayCap?: number | null;
    warmupDay?: number | null;
    orgName?: string | null;
    workspaceName?: string | null;
    baseUrl?: string | null;
}): string {
    // 이름이 없으면 "관리자가" (HR-7)
    const who = x.actorName ? `${u(x.actorName, 30)}님이` : "관리자가";
    // 메모는 한 줄·꾸밈 없이, 코드 포인트로 200자 (HR-1·HR-2·HR-10)
    const note = x.note ? ` (메모: "${u(x.note, 200)}")` : "";
    const via = x.via === "settings" ? " (발신 주소 설정에서 정지를 끔)" : "";
    const org = x.orgName ? `${u(x.orgName)} · ` : "";
    const link = x.baseUrl ? `\n자세히: ${x.baseUrl}/email#send-health` : "";
    const after = " 앞으로 보내는 메일만 보고 다시 살핍니다.";
    if (x.kind === "hold") {
        const where = x.workspaceName ? `${u(x.workspaceName)} › ` : "";
        // 기다리던 메일이 없으면 그 문장을 빼고 (HR-8)
        const q = typeof x.revived === "number" && x.revived > 0 ? ` 기다리던 메일 ${x.revived.toLocaleString("ko-KR")}통이 원래 순서대로 다시 나갑니다.` : "";
        return `[발송 건강 · 풀림] ${org}${where}명단 ${u(x.name)} — ${who} 보류를 풀었습니다${note}${via}.${q}${after}${link}`;
    }
    const cap =
        x.todayCap === undefined
            ? ""
            : ` 오늘 한도 ${x.todayCap === null ? "제한 없음" : `${x.todayCap}통`}${x.warmupDay ? ` (웜업 ${x.warmupDay}일째)` : ""}.`;
    return `[발송 건강 · 풀림] ${org}주소 ${u(x.name)} — ${who} 자동 멈춤을 풀었습니다${note}${via}.${cap}${after}${link}`;
}

// 결과 확인 알림의 고정 문장 — 한 조직 글(syncAlertText)과 여러 조직 합친 글(mergeSyncAlertTexts)이 같은 문장을 쓴다
const SYNC_ALERT_PREFIX = "[발송 건강 · NHN 결과 확인] ";
const SYNC_NEVER_PROBLEM =
    "메일이 실제로 도착했는지 NHN에서 받아 오는 10분 자동 작업이 아직 한 번도 돌지 않았습니다. 그래서 실패율을 몰라 위험한 명단을 자동으로 멈추지 못합니다.";
const SYNC_NEVER_TODO = "할 일: 개발 담당에게 결과 확인 정기 작업(status-sync) 등록을 부탁해 주세요.";
const SYNC_AUTH_PROBLEM =
    "샌드비 이메일 설정의 NHN 키(App Key·Secret Key)가 맞지 않습니다 (NHN 응답 401·403). 같은 키로 메일을 보내므로 발송도 실패하고 있을 수 있습니다.";
const SYNC_AUTH_TODO = "할 일: 이메일 설정에서 NHN 키를 확인해 주세요. 그동안 자동 조치(보류·멈춤)를 하지 않습니다.";
const SYNC_STALE_TODO =
    "보통 NHN 쪽 일시 오류라 저절로 풀립니다. 2시간 넘게 이어지면 개발 담당에게 알려 주세요. 그동안 자동 조치(보류·멈춤)를 하지 않습니다.";

export function syncAlertText(x: {
    cause: "stale" | "auth" | "recovered" | "never" | "never_recovered";
    orgName: string;
    lastOkAt: Date | null;
    lastError: string | null;
    /** 화면 링크 앞부분 (HS-7) */
    baseUrl?: string | null;
    /** 정체가 이어진 분 (stale) */
    staleMinutes?: number | null;
}): string {
    const last = x.lastOkAt ? formatKstShort(x.lastOkAt) : "없음";
    const head = `${SYNC_ALERT_PREFIX}${u(x.orgName)}`;
    const link = x.baseUrl ? `\n자세히: ${x.baseUrl}/email#send-health` : "";
    if (x.cause === "never") return `${head} — ${SYNC_NEVER_PROBLEM} ${SYNC_NEVER_TODO}${link}`;
    if (x.cause === "never_recovered") return `${head} — 결과 확인 자동 작업이 돌기 시작했습니다. 실패율 판정·자동 조치가 다시 됩니다.${link}`;
    if (x.cause === "recovered") return `${head} — 다시 정상입니다 (마지막 성공 ${last}).${link}`;
    if (x.cause === "auth") return `${head} — ${SYNC_AUTH_PROBLEM} 마지막 성공 ${last}. ${SYNC_AUTH_TODO}${link}`;
    const mins = x.staleMinutes && x.staleMinutes > 0 ? `${x.staleMinutes}분째` : "30분 넘게";
    return `${head} — NHN 결과 확인이 ${mins} 멈춰 있습니다 (마지막 성공 ${last}${x.lastError ? ` · 이유: ${u(x.lastError, 80)}` : ""}). ${SYNC_STALE_TODO}${link}`;
}

/** 한 조직 결과 확인 알림 글 → 원인·조직 이름·그 조직만의 내용. 결과 확인 경고 글이 아니면 null */
function parseSyncAlert(message: string): { cause: "never" | "auth" | "stale"; org: string; detail: string; link: string | null } | null {
    const [first = "", ...rest] = message.split("\n");
    const link = rest.find((l) => l.startsWith("자세히: ")) ?? null;
    if (!first.startsWith(SYNC_ALERT_PREFIX)) return null;
    const tail = first.slice(SYNC_ALERT_PREFIX.length);
    const never = ` — ${SYNC_NEVER_PROBLEM} ${SYNC_NEVER_TODO}`;
    if (tail.endsWith(never)) return { cause: "never", org: tail.slice(0, -never.length), detail: "", link };
    const authAt = tail.indexOf(` — ${SYNC_AUTH_PROBLEM} `);
    if (authAt >= 0 && tail.endsWith(` ${SYNC_AUTH_TODO}`)) {
        const detail = tail.slice(authAt + ` — ${SYNC_AUTH_PROBLEM} `.length, tail.length - ` ${SYNC_AUTH_TODO}`.length);
        return { cause: "auth", org: tail.slice(0, authAt), detail: detail.replace(/\.$/, ""), link };
    }
    // 조직 이름은 줄바꿈이 없고(chatSafe) 정체 글은 "{조직} — NHN 결과 확인이 {N분째|30분 넘게} 멈춰 있습니다 ({마지막 성공 …}). {고정 문장}"
    const staleTail = ` ${SYNC_STALE_TODO}`;
    if (tail.endsWith(staleTail)) {
        const m = /^(.*?) — NHN 결과 확인이 (\d+분째|30분 넘게) 멈춰 있습니다 \((.*)\)\.$/.exec(tail.slice(0, -staleTail.length));
        if (m) return { cause: "stale", org: m[1], detail: `${m[2]} 멈춤 · ${m[3]}`, link };
    }
    return null;
}

/**
 * 여러 조직의 같은 결과 확인 알림(같은 NHN 키 장애 등)을 운영 스페이스 한 통으로 (HS-11).
 * 같은 설명·할 일 문장은 한 번만 쓰고, 조직마다 다른 것(마지막 성공·멈춘 시간·이유)만 조직 목록에 붙인다 (구글 챗 QA N3). 10곳까지.
 * 글 모양을 알아보지 못하면(원인이 섞임 등) 조직마다 첫 줄을 목록으로
 */
export function mergeSyncAlertTexts(messages: readonly string[]): string {
    if (messages.length <= 1) return messages[0] ?? "";
    const head = `${SYNC_ALERT_PREFIX}조직 ${messages.length}곳에 같은 문제가 있습니다`;
    const link = messages[0].split("\n").find((l) => l.startsWith("자세히: "));
    const more = messages.length > 10 ? [`• 외 ${messages.length - 10}곳`] : [];
    const parsed = messages.map(parseSyncAlert);
    const cause = parsed[0]?.cause;
    if (cause && parsed.every((p) => p?.cause === cause)) {
        const items = (parsed as Array<NonNullable<ReturnType<typeof parseSyncAlert>>>).map((p) => `• ${p.org}${p.detail ? ` — ${p.detail}` : ""}`);
        const problem = cause === "never" ? SYNC_NEVER_PROBLEM : cause === "auth" ? SYNC_AUTH_PROBLEM : "NHN 결과 확인이 30분 넘게 멈춰 있습니다.";
        const todo = cause === "never" ? SYNC_NEVER_TODO : cause === "auth" ? SYNC_AUTH_TODO : SYNC_STALE_TODO;
        return [head, problem, ...items.slice(0, 10), ...more, todo, ...(link ? [link] : [])].join("\n");
    }
    const firstLines = messages.map((m) => (m.split("\n")[0] ?? "").replace(SYNC_ALERT_PREFIX, ""));
    return [head, ...firstLines.slice(0, 10).map((l) => `• ${l}`), ...more, ...(link ? [link] : [])].join("\n");
}

/** 묶음 알림 글 상한 (구글 챗 한 통) */
export const ALERT_TEXT_MAX = 3800;

/**
 * 한 회차의 새 사건을 받는 곳마다 한 통으로 (SND-13). 3,800자 안에서 블록을 담고, 넘치는 긴 블록은 줄 단위로 자르거나 건너뛰고
 * 뒤의 짧은 블록은 계속 담는다 (HB-4). 끝에 늘 화면 링크 (HB-9). worse = 더 나빠져 다시 알리는 블록 (HB-8)
 */
export function batchAlertText(x: { orgName: string; blocks: readonly string[]; baseUrl: string; worse?: readonly boolean[] }): string {
    const n = x.blocks.length;
    const worse = (x.worse ?? []).filter(Boolean).length;
    const head = `[발송 건강] ${u(x.orgName)} — 알림 ${n}건${worse > 0 ? ` (새로 생긴 일 ${n - worse} · 더 나빠진 일 ${worse})` : ""}`;
    const link = `자세히: ${x.baseUrl}/email#send-health`;
    // "외 N건" 줄과 링크 자리를 남긴다
    const budget = ALERT_TEXT_MAX - link.length - 40;
    const out: string[] = [head];
    let len = head.length;
    let shown = 0;
    for (const b of x.blocks) {
        const add = 2 + b.length;
        if (len + add <= budget) {
            out.push(b);
            len += add;
            shown++;
            continue;
        }
        const cut = cutBlock(b, budget - len - 2);
        if (cut) {
            out.push(cut);
            len += 2 + cut.length;
            shown++;
        }
    }
    if (shown < n) out.push(`외 ${n - shown}건 — 화면에서 보기`);
    out.push(link);
    return out.join("\n\n");
}

/** 긴 블록을 줄 단위로 room 안에 자른다 (머리 줄은 남긴다). 200자도 안 남았으면 null */
function cutBlock(block: string, room: number): string | null {
    const tail = "\n…(나머지는 화면에서 보기)";
    if (room < 200) return null;
    const lines = block.split("\n");
    const kept: string[] = [];
    let len = 0;
    for (const line of lines) {
        const add = (kept.length > 0 ? 1 : 0) + line.length;
        if (len + add + tail.length > room) break;
        kept.push(line);
        len += add;
    }
    if (kept.length === 0) {
        const first = Array.from(lines[0] ?? "").slice(0, Math.max(0, room - tail.length - 1)).join("");
        return `${first}…${tail}`;
    }
    return kept.join("\n") + tail;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function reportDateLabel(now: Date): string {
    const p = kstParts(now);
    const [, m, d] = p.date.split("-").map(Number);
    return `${m}/${d}(${WEEKDAYS[weekdayOfYmd(p.date)]}) ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export interface DailyReportInput {
    orgName: string;
    scopeLabel: string | null;
    now: Date;
    mode: SendHealthMode;
    dsnInRate: boolean;
    evaluation: HealthEvaluation;
    partitionNames: ReadonlyMap<number, string>;
    senderEmails: ReadonlyMap<number, string>;
    /** 이어지는 위험 (지금 위험인데 오늘 새 사건이 없는 것) */
    continuing: ReadonlyArray<{ label: string; rate: string }>;
    holds: ReadonlyArray<{ name: string; heldAt: Date; queued: number }>;
    autoPaused: ReadonlyArray<{ email: string; pausedAt: Date | null }>;
    /** 조직 전체 반송 안내 숫자 — 사업 스페이스 보고에는 넣지 않는다 (다른 사업 숫자가 섞이지 않게, HD-02) */
    dsn: { unpaired: number; different: number; complaints: number } | null;
    sync: {
        lastOkAt: Date | null;
        cursor: Date | null;
        unconfirmedOld: number;
        unpaired: number;
        lastErrorCode: string | null;
        /** 마지막 오류 한 줄 (키·주소 없음, HD-10) */
        lastError?: string | null;
        /** NHN이 오래된 기간이라 거절해 건너뛴 창 누적 (OPS-7) */
        skippedWindowsTotal?: number;
        skippedWindowsLastAt?: Date | null;
    } | null;
    /** NHN 결과 확인이 한 번도 돌지 않았다 (status-sync 정기 작업 없음, OPS-8) — 운영 보고에만 */
    syncNeverRan?: boolean;
    reply: { lastSuccessAt: Date | null; mode: string; replies: number; bounces: number } | null;
    nhnUnsub: number;
    /** 링크 수신거부 (조직 전체) — 사업 스페이스 보고에는 null (HD-02) */
    linkUnsub: number | null;
    /** 화면 링크 앞부분 (HD-14) */
    baseUrl?: string | null;
    /** 알림 전달 문제·어제 못 보낸 알림 한 줄 (WPN-4·HB-7) */
    deliveryLine?: string | null;
    /** 어제 보고를 보내지 못했으면 그 까닭 (HD-15) */
    missedReport?: string | null;
}

/** 운영 보고 끝 줄 — 발송 건강이 지금 무엇을 하는지 (설정값 이름 대신 쉬운 말, 구글 챗 QA N5) */
const MODE_PLAIN: Record<SendHealthMode, string> = {
    off: "꺼짐 — 점검하지 않음",
    dry_run: "기록만 — 알림·자동 멈춤 없음 (시험)",
    alert: "알림만 — 위험해도 자동으로 멈추지 않음",
    enforce: "알림 + 위험한 명단·주소 자동 멈춤",
};

/** 회신 읽기 모드 (REPLY_SYNC_MODE) → 쉬운 말 */
const REPLY_MODE_PLAIN: Record<string, string> = {
    on: "켜짐",
    dry_run: "시험 중 — 회신이 와도 자동 메일은 멈추지 않음",
    off: "꺼짐",
};

/** 매일 보고 목록 줄 안의 이름 상한 (코드 포인트) — 아주 긴 이름 하나가 보고를 다 먹지 않게 */
const REPORT_NAME_MAX = 60;
const REPORT_ADDRESS_MAX = 80;

/** UTF-16 길이(구글 챗 글 상한을 세는 단위)로 max 안에 자른다. 서로게이트 쌍을 가르지 않고, 잘렸으면 "…" */
function clipUnits(text: string, max: number): string {
    if (text.length <= max) return text;
    let out = "";
    for (const ch of text) {
        if (out.length + ch.length + 1 > max) break;
        out += ch;
    }
    return `${out}…`;
}

/**
 * 매일 보고 줄을 ALERT_TEXT_MAX(3,800자) 안에 담는다 (구글 챗 QA N4 — 다른 알림과 같은 상한).
 * keep 줄(머리·위험/주의 수·할 일·알림 전달·설정)은 늘 담고, 나머지 목록 줄은 앞에서부터 들어가는 만큼 담는다.
 * 넘치는 줄은 남은 자리가 넉넉하면 줄 끝을 자르고, 아니면 빼고 "외 N건 — 화면에서 보기"를 붙인다. 화면 링크는 늘 맨 끝
 */
function fitReportLines(lines: ReadonlyArray<{ text: string; keep?: boolean }>, link: string | null): string {
    const tail = link ? [link] : [];
    const full = [...lines.map((l) => l.text), ...tail].join("\n");
    if (full.length <= ALERT_TEXT_MAX) return full;
    const more = "외 999건 — 화면에서 보기";
    const keepLen = lines.filter((l) => l.keep).reduce((a, l) => a + l.text.length + 1, 0);
    let room = ALERT_TEXT_MAX - keepLen - (link ? link.length + 1 : 0) - more.length;
    const out: string[] = [];
    let dropped = 0;
    for (const l of lines) {
        if (l.keep) {
            out.push(l.text);
            continue;
        }
        if (l.text.length + 1 <= room) {
            out.push(l.text);
            room -= l.text.length + 1;
        } else if (room >= 120) {
            const cut = clipUnits(l.text, room - 1);
            out.push(cut);
            room -= cut.length + 1;
        } else {
            dropped++;
        }
    }
    if (dropped > 0) out.push(`외 ${dropped}건 — 화면에서 보기`);
    return [...out, ...tail].join("\n");
}

/**
 * 매일 보고 (7-4). 실을 것이 없으면 null (사업 스페이스 보고는 위험·주의·보류가 하나도 없으면 보내지 않는다 — 부른 쪽이 고른다).
 * 읽는 사람은 비개발자 대표·사업 담당이다 — 상태 코드는 풀이 뒤 괄호로, 설정값 이름 대신 쉬운 말로 (HD-07·구글 챗 QA N5).
 * 목록 줄은 다른 알림과 같은 글머리표 "• "로 (N7). 3,800자를 넘으면 목록 줄부터 줄인다 (N4)
 */
export function dailyReportText(x: DailyReportInput): string {
    const ev = x.evaluation;
    const ops = x.scopeLabel === null;
    const name = (v: unknown) => u(v, REPORT_NAME_MAX);
    const email = (sid: number) => u(x.senderEmails.get(sid) || (sid === 0 ? "기본 발신 주소" : `주소 ${sid}`), REPORT_ADDRESS_MAX);
    const dangerP = ev.partitions.filter((p) => p.state === "danger");
    const dangerS = ev.senders.filter((s) => s.state === "danger");
    const cautionP = ev.partitions.filter((p) => p.state === "caution");
    const cautionS = ev.senders.filter((s) => s.state === "caution");
    const cautionD = ev.domains.filter((d) => d.state !== "ok");
    const insuffP = ev.partitions.filter((p) => p.state === "insufficient");
    const insuffS = ev.senders.filter((s) => s.state === "insufficient");
    const slow = ev.partitions.filter((p) => p.evalWindow === "30d" && p.state !== "insufficient");
    const recovered = [...ev.partitions.filter((p) => p.recovered).map((p) => name(p.name)), ...ev.senders.filter((s) => s.recovered).map((s) => email(s.profileId))];
    const rateOf = (rate: number | null, final: number, failed: number) => `${formatRate(rate)} (결과 ${final}통 중 실패 ${failed}통)`;

    const lines: Array<{ text: string; keep?: boolean }> = [];
    const keep = (text: string) => lines.push({ text, keep: true });
    const add = (text: string) => lines.push({ text });
    keep(`[발송 건강 · ${reportDateLabel(x.now)}] ${u(x.orgName, 80)}${x.scopeLabel ? ` › ${u(x.scopeLabel, 80)}` : ""}`);
    if (x.missedReport) keep(`⚠️ 어제 보고를 보내지 못했습니다 — ${u(x.missedReport, 120)}`);
    keep(`위험: 명단 ${dangerP.length}${dangerP.some((p) => p.held) ? " (보류 중 포함)" : ""} · 주소 ${dangerS.length}`);
    keep(`주의: 명단 ${cautionP.length} · 주소 ${cautionS.length} · 발신 인증 실패 도메인 ${cautionD.length}`);
    for (const p of cautionP.slice(0, 5)) add(`• ${name(p.name)} ${rateOf(p.rateBp, p.final, p.failedCount)}`);
    for (const s of cautionS.slice(0, 5)) add(`• ${email(s.profileId)} ${rateOf(s.rateBp, s.final, s.failedCount)}`);
    for (const d of cautionD.slice(0, 5)) {
        add(`• ${u(d.domain, REPORT_ADDRESS_MAX)} 발신 인증 실패(도메인 SPF·DKIM·DMARC) ${d.senderSide24h}통 — 도메인 인증 확인 필요`);
    }
    if (x.continuing.length > 0) {
        add(`이어지는 위험 (이미 알렸고 다시 보내지 않음): ${x.continuing.slice(0, 5).map((c) => `${name(c.label)} ${c.rate}`).join(" · ")}`);
    }
    keep(
        `아직 판단 못 함 (결과 200통 미만): 명단 ${insuffP.length} · 주소 ${insuffS.length}${slow.length > 0 ? ` (발송이 적어 30일치로 본 명단 ${slow.length})` : ""}`
    );
    if (x.holds.length > 0 || x.autoPaused.length > 0) {
        const hs = x.holds.slice(0, 5).map((h) => `${name(h.name)} (${formatKstShort(h.heldAt)}부터, 기다리는 메일 ${h.queued.toLocaleString("ko-KR")}통)`);
        const ss = x.autoPaused.slice(0, 5).map((s) => `${u(s.email, REPORT_ADDRESS_MAX)} (자동 멈춤${s.pausedAt ? ` ${formatKstShort(s.pausedAt)}부터` : ""})`);
        add(`발송 보류·멈춤 중: ${[...hs, ...ss].join(" · ")}`);
    }
    if (recovered.length > 0) add(`회복: ${recovered.length} (${recovered.slice(0, 5).join(", ")})`);
    const dsnTop = ev.partitions
        .filter((p) => p.dsnOnly > 0)
        .sort((a, b) => b.dsnOnly - a.dsnOnly)
        .slice(0, 3)
        .map((p) => `${name(p.name)} ${p.dsnOnly}통(${formatRate(rateBp(p.dsnOnly, p.final + p.dsnOnly))})`);
    const dsnOrg = x.dsn
        ? ` · 어느 메일의 반송인지 못 찾음 ${x.dsn.unpaired} · 보낸 주소와 다른 주소에서 돌아온 반송 ${x.dsn.different} · 스팸 신고 ${x.dsn.complaints}`
        : "";
    add(`반송 안내(실패율에 ${x.dsnInRate ? "넣음" : "아직 안 넣음"}): ${dsnTop.length > 0 ? `많은 명단 — ${dsnTop.join(" · ")}` : "0"}${dsnOrg}`);
    if (x.sync) {
        const skipped = x.sync.skippedWindowsTotal ?? 0;
        const err =
            x.sync.lastErrorCode === "auth"
                ? " · NHN 키 확인 필요"
                : x.sync.lastErrorCode
                  ? ` · 마지막 오류: ${u(x.sync.lastError ?? x.sync.lastErrorCode, 80)}`
                  : "";
        add(
            `NHN 결과 확인: 마지막 성공 ${x.sync.lastOkAt ? formatKstShort(x.sync.lastOkAt) : "없음"} · ` +
                `결과를 받아 온 때 ${x.sync.cursor ? `${formatKstShort(x.sync.cursor)}까지` : "없음"} · ` +
                `보낸 지 2시간이 지나도 결과가 없는 메일 ${x.sync.unconfirmedOld}통 · ` +
                `샌드비 발송 기록에 없는 NHN 결과 ${x.sync.unpaired}건(같은 NHN 키로 보낸 다른 메일)${err}` +
                (skipped > 0
                    ? ` · NHN이 너무 지난 기간이라 결과를 주지 않아 건너뛴 구간 ${skipped}개${x.sync.skippedWindowsLastAt ? ` (마지막 ${formatKstShort(x.sync.skippedWindowsLastAt)})` : ""}`
                    : "")
        );
    } else if (x.syncNeverRan) {
        keep("NHN 결과 확인: 한 번도 돌지 않음 — 결과 확인 정기 작업(status-sync) 등록이 필요합니다 (그동안 실패율 판정·자동 조치가 되지 않습니다)");
    }
    if (x.reply) {
        add(
            `회신 읽기 (${REPLY_MODE_PLAIN[x.reply.mode] ?? u(x.reply.mode, 20)}): 마지막 성공 ${x.reply.lastSuccessAt ? formatKstShort(x.reply.lastSuccessAt) : "없음"} · 어제 회신 ${x.reply.replies}통 · 반송 안내 ${x.reply.bounces}통`
        );
    }
    add(`수신거부: NHN ${x.nhnUnsub}통${x.linkUnsub !== null ? ` · 링크 ${x.linkUnsub}통` : ""}`);
    if (cautionP.length + cautionS.length + dangerP.length + dangerS.length + x.holds.length + x.autoPaused.length > 0) {
        keep("할 일: 주의·위험 명단은 주소 품질(오래된 명단·잘못된 주소)을 확인하고, 보류·멈춘 것은 관리자가 발송 건강 화면에서 확인 뒤 풀어 주세요.");
    }
    if (x.deliveryLine) keep(clipUnits(x.deliveryLine, 600));
    if (ops) keep(`발송 건강 설정: ${MODE_PLAIN[x.mode]}`);
    return fitReportLines(lines, x.baseUrl ? `자세히: ${x.baseUrl}/email#send-health` : null);
}

/** 사업 스페이스 보고는 실을 것(위험·주의·보류)이 하나도 없으면 보내지 않는다 */
export function hasReportableItems(ev: HealthEvaluation, holds: number, autoPaused: number): boolean {
    return (
        holds > 0 ||
        autoPaused > 0 ||
        ev.partitions.some((p) => p.state === "danger" || p.state === "caution") ||
        ev.senders.some((s) => s.state === "danger" || s.state === "caution") ||
        ev.domains.some((d) => d.state !== "ok")
    );
}

/** 수동 발송 409 글 (6-2, SND-16) */
export function manualHoldMessage(x: { partitionName: string; reasonText: string; heldAt: Date }): string {
    return `이 명단은 발송 실패가 많아 보류 중입니다 (${x.partitionName}, ${x.reasonText}, ${formatKstShort(x.heldAt)}부터). 관리자가 보류를 풀면 보낼 수 있습니다.`;
}

/** 보류 사유 한 줄 (보류 표 reason_text — 받는 주소 없음) */
export function holdReasonText(p: PartitionEval): string {
    return `${windowLabel(p.evalWindow)} 확정 ${p.final}통 중 실패 ${p.failedCount}통 (${formatRate(p.rateBp)})`;
}

/** 오늘(KST) 날짜와 그 시작 시각 — 상한을 세는 하루 */
export function kstDayStart(now: Date): { date: string; start: Date } {
    const date = kstParts(now).date;
    const [y, m, d] = date.split("-").map(Number);
    return { date, start: new Date(Date.UTC(y, m - 1, d) - 9 * HOUR_MS) };
}

/** 어제(KST) [시작, 끝) — 매일 보고의 "어제 회신" */
export function kstYesterdayRange(now: Date): { start: Date; end: Date } {
    const today = kstDayStart(now);
    const yesterday = addDaysYmd(today.date, -1);
    const [y, m, d] = yesterday.split("-").map(Number);
    return { start: new Date(Date.UTC(y, m - 1, d) - 9 * HOUR_MS), end: today.start };
}
