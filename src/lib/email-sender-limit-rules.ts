/**
 * 발신 주소(발신 프로필)별 하루 발송 한도·웜업·발송 시간대·발신 주소 묶음 판정. DB를 모른다.
 *
 * 자리 잡기(email-sender-limit.ts)·발송 경로·설정 API·설정 화면이 같은 규칙을 써야 숫자가 어긋나지 않는다.
 * 테스트가 이 파일만 import하면 DB 커넥션이 열리지 않도록 분리해 두었다 (@/lib/db import 금지).
 * 화면(14일 미리보기)도 이 파일을 그대로 쓰므로 서버 전용 모듈을 들이지 않는다.
 *
 * 시간은 모두 한국 시각(KST) 벽시계로 판단한다. 한도는 "한국 날짜 하루"에 걸린다. KST 계산은 kst.ts를 쓴다.
 * 설계: docs/2026-10-02-sender-warmup/DESIGN.md 1~2절.
 */

import {
    addDaysYmd,
    formatKstShort,
    isWeekdayYmd,
    kstParts,
    kstToDate,
    weekdayOfYmd,
} from "@/lib/kst";

// ============================================
// 설정 타입·기본값
// ============================================

export interface SenderLimitSettings {
    /** 하루 최대 발송 수. null = 제한 없음. 웜업을 켜면 웜업이 올라가다 멈추는 상한이다 */
    dailyLimit: number | null;
    warmupEnabled: boolean;
    /** 웜업 첫날 보낼 수. null이면 DEFAULT_WARMUP_START */
    warmupStartCount: number | null;
    /** 웜업 중 하루에 늘리는 수. null이면 DEFAULT_WARMUP_STEP */
    warmupStep: number | null;
    /** 웜업을 시작한 날 "YYYY-MM-DD" (KST). 서버가 웜업을 켤 때 정한다 */
    warmupStartedOn: string | null;
    /** 보낼 수 있는 시간대 시작 시 (KST, 0~23, 포함). 끝 시와 둘 다 null이면 시간 제한 없음 */
    sendWindowStart: number | null;
    /** 보낼 수 있는 시간대 끝 시 (KST, 1~24, 미포함) */
    sendWindowEnd: number | null;
    /** 토·일요일에는 보내지 않는다 */
    weekdaysOnly: boolean;
    /** 하루 한도를 시간대 안에서 같은 간격으로 나눠 보낸다 */
    spreadEvenly: boolean;
    /** 이 주소의 발송을 멈춘다 */
    isPaused: boolean;
}

/** 전부 꺼진 설정. 한도 칸을 하나도 켜지 않은 주소는 지금까지처럼 바로 나간다 */
export const DEFAULT_LIMIT_SETTINGS: SenderLimitSettings = Object.freeze({
    dailyLimit: null,
    warmupEnabled: false,
    warmupStartCount: null,
    warmupStep: null,
    warmupStartedOn: null,
    sendWindowStart: null,
    sendWindowEnd: null,
    weekdaysOnly: false,
    spreadEvenly: false,
    isPaused: false,
});

export const DEFAULT_WARMUP_START = 10;
export const DEFAULT_WARMUP_STEP = 5;
/**
 * 시간대를 정하지 않았는데 다음 날로 미뤄야 할 때 다시 보내기 시작하는 시각(KST).
 * 0시로 두면 미뤄진 메일이 한밤중에 한꺼번에 나간다.
 */
export const DEFAULT_RESUME_HOUR = 9;
/** AI 규칙 하나에 묶을 수 있는 발신 주소 수 */
export const MAX_SENDER_POOL_SIZE = 50;
/**
 * API가 받는 묶음 배열의 최대 길이 (중복 포함). 중복을 걸러 내기 전에 먼저 본다 —
 * 로그인한 사용자가 큰 배열을 보내 요청 하나로 서버를 붙잡지 못하게 한다.
 * 화면은 서로 다른 id를 50개 이하로 보내므로 중복이 조금 섞여도 막히지 않을 만큼 넉넉히 둔다.
 */
export const MAX_SENDER_POOL_INPUT = 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_RE = /^-?\d+$/;

// ============================================
// 내부 도우미
// ============================================

type Parsed<T> = { ok: true; value: T } | { ok: false };

/**
 * 정수만 받는다 (숫자 또는 숫자 문자열). null·""는 비움.
 * Number()로 바꾸면 true → 1, [7] → 7, 2.9 → 2처럼 엉뚱한 값이 조용히 통과한다.
 */
function parseInteger(v: unknown): Parsed<number | null> {
    if (v === null) return { ok: true, value: null };
    if (typeof v === "number") {
        return Number.isSafeInteger(v) ? { ok: true, value: v } : { ok: false };
    }
    if (typeof v === "string") {
        const t = v.trim();
        if (t === "") return { ok: true, value: null };
        if (!INT_RE.test(t)) return { ok: false };
        const n = Number(t);
        return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false };
    }
    return { ok: false };
}

/** true/false, "true"/"false", 1/0, "1"/"0"만 받는다. Boolean("false")는 true라 쓰면 안 된다 */
function parseBoolean(v: unknown): Parsed<boolean> {
    if (v === true || v === 1 || v === "true" || v === "1") return { ok: true, value: true };
    if (v === false || v === 0 || v === "false" || v === "0") return { ok: true, value: false };
    return { ok: false };
}

function isValidYmd(ymd: unknown): ymd is string {
    // 2026-02-30처럼 모양만 맞는 날짜는 addDaysYmd가 다음 달로 넘겨 버리므로 되돌려 비교한다
    return typeof ymd === "string" && YMD_RE.test(ymd) && addDaysYmd(ymd, 0) === ymd;
}

/** 두 KST 날짜 사이 날수 (to - from) */
function daysBetween(from: string, to: string): number {
    return Math.round((kstToDate(to, 0).getTime() - kstToDate(from, 0).getTime()) / DAY_MS);
}

function isWeekendWeekday(weekday: number): boolean {
    return weekday === 0 || weekday === 6;
}

function isAllowedYmd(s: SenderLimitSettings, ymd: string): boolean {
    return !s.weekdaysOnly || isWeekdayYmd(ymd);
}

function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
}

/**
 * 저장된 시작·끝 시를 쓸 수 있는 시간대로 바꾼다. 둘 다 없으면 null(시간 제한 없음).
 *
 * 한쪽만 있거나 끝이 시작보다 이르면 시간 제한을 푸는 대신 좁게 잡는다 —
 * 어긋난 값 때문에 밤새 나가는 것보다 늦게 나가는 편이 낫다. 저장 검증이 막지만 옛 값·직접 고친 값을 위한 것이다.
 */
function normalizeWindow(start: number | null, end: number | null): { start: number; end: number } | null {
    const s = typeof start === "number" && Number.isFinite(start) ? Math.floor(start) : null;
    const e = typeof end === "number" && Number.isFinite(end) ? Math.floor(end) : null;
    if (s === null && e === null) return null;
    const from = clamp(s ?? 0, 0, 23);
    let to = clamp(e ?? 24, 1, 24);
    if (to <= from) to = 24;
    return { start: from, end: to };
}

function windowOf(s: SenderLimitSettings): { start: number; end: number } | null {
    return normalizeWindow(s.sendWindowStart, s.sendWindowEnd);
}

function readInt(v: unknown): number | null {
    const p = parseInteger(v);
    return p.ok ? p.value : null;
}

function readNonNegativeInt(v: unknown): number | null {
    const n = readInt(v);
    return n === null ? null : Math.max(0, n);
}

function readBool(v: unknown): boolean {
    const p = parseBoolean(v);
    return p.ok && p.value;
}

function readYmd(v: unknown): string | null {
    if (isValidYmd(v)) return v;
    // date 형 칸으로 읽히면 UTC 자정 Date로 온다 — 그 날짜 그대로 쓴다
    if (v instanceof Date && Number.isFinite(v.getTime())) return v.toISOString().slice(0, 10);
    return null;
}

function isPositiveInt(v: unknown): v is number {
    return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
}

/** 받침이 있으면 "은", 없으면 "는". 한글이 아니면 둘 다 적는다 */
function topicParticle(word: string): string {
    const code = word.charCodeAt(word.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return "은(는)";
    return (code - 0xac00) % 28 === 0 ? "는" : "은";
}

// ============================================
// 설정 읽기
// ============================================

/**
 * DB 행(또는 그 일부)을 판정용 설정으로 바꾼다. 없거나 잘못된 칸은 "꺼짐"으로 본다.
 * 시간대만은 어긋나 있으면 좁게 고친다 (normalizeWindow).
 */
export function toLimitSettings(
    row: Partial<Record<keyof SenderLimitSettings, unknown>> | null | undefined,
): SenderLimitSettings {
    if (!row) return { ...DEFAULT_LIMIT_SETTINGS };
    const window = normalizeWindow(readInt(row.sendWindowStart), readInt(row.sendWindowEnd));
    return {
        dailyLimit: readNonNegativeInt(row.dailyLimit),
        warmupEnabled: readBool(row.warmupEnabled),
        warmupStartCount: readNonNegativeInt(row.warmupStartCount),
        warmupStep: readNonNegativeInt(row.warmupStep),
        warmupStartedOn: readYmd(row.warmupStartedOn),
        sendWindowStart: window ? window.start : null,
        sendWindowEnd: window ? window.end : null,
        weekdaysOnly: readBool(row.weekdaysOnly),
        spreadEvenly: readBool(row.spreadEvenly),
        isPaused: readBool(row.isPaused),
    };
}

/**
 * 한도·웜업·시간대·요일·정지 중 하나라도 켜져 있는가. 하나도 없으면 지금까지처럼 바로 보낸다.
 * 고르게 나눠 보내기는 한도와 시간대가 있어야 뜻이 있으므로 혼자서는 세지 않는다.
 */
export function hasAnyLimit(s: SenderLimitSettings): boolean {
    return (
        s.isPaused ||
        s.dailyLimit !== null ||
        s.warmupEnabled ||
        windowOf(s) !== null ||
        s.weekdaysOnly
    );
}

// ============================================
// 하루 한도·웜업
// ============================================

/**
 * 웜업 며칠째 (시작일 = 0). 보낼 수 있는 날만 센다 — 평일만이면 주말은 세지 않는다.
 *
 * warmupStartedOn부터 date 전날까지 "보낼 수 있는 날" 수다. 달력 날수로 세면 평일만 주소가
 * 금요일에서 월요일로 넘어갈 때 세 단계가 한꺼번에 올라 웜업 뜻이 없어진다.
 * 시작일이 없거나 date가 시작일보다 이르면 0. 정지한 날도 세는 것은 정지 이력이 없어서다 (범위 밖).
 */
export function warmupDayIndex(s: SenderLimitSettings, date: string): number {
    const startedOn = s.warmupStartedOn;
    if (!isValidYmd(startedOn) || !isValidYmd(date)) return 0;
    const total = daysBetween(startedOn, date);
    if (total <= 0) return 0;
    if (!s.weekdaysOnly) return total;

    // 몇 년치도 반복 없이 센다: 온전한 주마다 평일 5일, 남은 날은 요일을 하나씩 본다
    const fullWeeks = Math.floor(total / 7);
    let count = fullWeeks * 5;
    const startWeekday = weekdayOfYmd(startedOn);
    for (let i = 0; i < total % 7; i++) {
        if (!isWeekendWeekday((startWeekday + i) % 7)) count++;
    }
    return count;
}

/**
 * 그날(KST) 이 주소가 보낼 수 있는 최대 수. null = 제한 없음.
 *
 * - 정지면 0. 평일만인데 주말이면 0 (그날은 아예 못 보낸다 — 미리보기에서 바로 보이게)
 * - 웜업: 첫날 warmupStartCount통, 보낼 수 있는 날마다 warmupStep통씩 늘려 dailyLimit에서 멈춘다
 * - 웜업이 켜졌는데 시작일이 없으면 그날을 0일째로 본다 (API가 켤 때 반드시 기록한다)
 */
export function capForDate(s: SenderLimitSettings, date: string): number | null {
    if (s.isPaused) return 0;
    if (isValidYmd(date) && !isAllowedYmd(s, date)) return 0;
    let cap: number | null = s.dailyLimit;
    if (s.warmupEnabled) {
        const start = Math.max(0, s.warmupStartCount ?? DEFAULT_WARMUP_START);
        const step = Math.max(0, s.warmupStep ?? DEFAULT_WARMUP_STEP);
        const ramp = start + step * warmupDayIndex(s, date);
        // 하루 최대가 없으면 웜업이 끝없이 오른다 — 저장 검증이 막지만, 그래도 한도 없음보다는 낫다
        cap = cap === null ? ramp : Math.min(cap, ramp);
    }
    return cap === null ? null : Math.max(0, Math.floor(cap));
}

/** fromDate부터 days일 동안의 하루 한도 (설정 화면 미리보기) */
export function capSchedule(
    s: SenderLimitSettings,
    fromDate: string,
    days: number,
): Array<{ date: string; cap: number | null }> {
    if (!isValidYmd(fromDate) || !Number.isFinite(days) || days <= 0) return [];
    return Array.from({ length: Math.floor(days) }, (_, i) => {
        const date = addDaysYmd(fromDate, i);
        return { date, cap: capForDate(s, date) };
    });
}

// ============================================
// 시간대·간격
// ============================================

/** 지금이 이 주소로 보내도 되는 요일·시간인가. 정지·한도는 보지 않는다 (decideSlot이 본다) */
export function isSendableNow(s: SenderLimitSettings, now: Date): boolean {
    const p = kstParts(now);
    if (s.weekdaysOnly && isWeekendWeekday(p.weekday)) return false;
    const w = windowOf(s);
    return w === null || (p.hour >= w.start && p.hour < w.end);
}

/**
 * now 이후 처음으로 보낼 수 있는 시각. 늘 새 Date를 돌려준다 (호출한 쪽이 고쳐도 now가 바뀌지 않게).
 * skipToday=true면 오늘은 건너뛰고 다음 보낼 수 있는 날의 시작을 준다 — 정지·오늘 한도를 다 썼을 때 쓴다.
 */
export function nextSendableAt(s: SenderLimitSettings, now: Date, skipToday = false): Date {
    const p = kstParts(now);
    const w = windowOf(s);

    if (!skipToday && isAllowedYmd(s, p.date)) {
        if (w === null) return new Date(now.getTime());
        if (p.hour < w.start) return kstToDate(p.date, w.start);
        if (p.hour < w.end) return new Date(now.getTime());
    }

    // 막는 요일은 토·일뿐이라 사흘 안에 반드시 보낼 수 있는 날이 나온다
    let day = addDaysYmd(p.date, 1);
    while (!isAllowedYmd(s, day)) day = addDaysYmd(day, 1);
    return kstToDate(day, w ? w.start : DEFAULT_RESUME_HOUR);
}

/**
 * 고르게 나눌 때 두 발송 사이 최소 간격 (ms). 0 = 간격 없음.
 *
 * 분 단위로 자르면 한도가 시간대 분 수보다 클 때(9~18시에 600통) 간격이 0이 되어 몰려 나간다.
 * 시간대가 없으면 나눌 길이가 없으므로 쓰지 않는다 (저장 검증에서 막는다).
 * 실제 간격의 하한은 대기열 cron 주기다 — 주기보다 짧은 간격은 주기만큼 벌어진다.
 */
export function spreadGapMs(s: SenderLimitSettings, cap: number | null): number {
    if (!s.spreadEvenly || cap === null || cap <= 0) return 0;
    const w = windowOf(s);
    if (w === null) return 0;
    return Math.floor(((w.end - w.start) * HOUR_MS) / cap);
}

// ============================================
// 한 통 판정·묶음 고르기
// ============================================

export type SlotDeferReason = "paused" | "outside_window" | "daily_limit" | "spacing";

export type SlotDecision =
    | { ok: true }
    | { ok: false; retryAt: Date; reason: SlotDeferReason };

/**
 * 지금 한 통을 더 보내도 되는지 판정한다.
 * usage는 "오늘(KST)" 이 주소의 사용량이다 — 날이 바뀌면 0부터 다시 센다.
 *
 * 순서: 정지 → 시간대·요일 → 오늘 한도 → 간격. 앞의 이유일수록 더 오래 막힌다.
 */
export function decideSlot(
    s: SenderLimitSettings,
    now: Date,
    usage: { sentToday: number; lastSentAt: Date | null },
): SlotDecision {
    if (s.isPaused) {
        return { ok: false, retryAt: nextSendableAt(s, now, true), reason: "paused" };
    }
    if (!isSendableNow(s, now)) {
        return { ok: false, retryAt: nextSendableAt(s, now), reason: "outside_window" };
    }

    const today = kstParts(now).date;
    const cap = capForDate(s, today);
    if (cap !== null && usage.sentToday >= cap) {
        return { ok: false, retryAt: nextSendableAt(s, now, true), reason: "daily_limit" };
    }

    const gap = spreadGapMs(s, cap);
    const lastMs = usage.lastSentAt ? usage.lastSentAt.getTime() : NaN;
    if (gap > 0 && Number.isFinite(lastMs)) {
        const earliest = new Date(lastMs + gap);
        if (earliest.getTime() > now.getTime()) {
            // 기다리는 사이 시간대가 닫히면 그 시각에 깨워도 outside_window로 한 번 더 미뤄진다 —
            // 꺼낼 때마다 시도 횟수가 오르므로 바로 다음 보낼 수 있는 날 시작으로 보낸다
            const stillOpen = kstParts(earliest).date === today && isSendableNow(s, earliest);
            return {
                ok: false,
                retryAt: stillOpen ? earliest : nextSendableAt(s, now, true),
                reason: "spacing",
            };
        }
    }
    return { ok: true };
}

export interface PoolCandidate {
    id: number;
    settings: SenderLimitSettings;
    usage: { sentToday: number; lastSentAt: Date | null };
}

export type PoolRank =
    | { ok: true; order: number[] }
    | { ok: false; retryAt: Date; reason: SlotDeferReason };

/**
 * 묶음(풀)에서 시도할 순서를 정한다.
 *
 * - 후보마다 decideSlot. 통과한 후보를 lastSentAt이 오래된 순(오늘 안 보낸 주소가 먼저), 같으면 묶음 순서로.
 *   한도가 없는 주소만 있어도 돌아가며 쓰게 된다
 * - 전부 막히면 정지 아닌 후보 중 가장 이른 retryAt과 그 이유. 정지한 주소를 넣으면
 *   다른 주소가 열리기 전에 매일 헛걸음을 하게 된다
 * - 전부 정지면 그중 가장 이른 retryAt, reason "paused"
 * - 후보가 없으면 { ok: true, order: [] } — 막힌 게 아니라 고를 게 없는 것이다 (호출한 쪽이 기본 주소로)
 *
 * 같은 id가 두 번 오면 앞의 것만 본다.
 */
export function rankPool(cands: readonly PoolCandidate[], now: Date): PoolRank {
    const seen = new Set<number>();
    const passed: Array<{ id: number; index: number; lastMs: number }> = [];
    let blocked: { retryAt: Date; reason: SlotDeferReason } | null = null;
    let paused: { retryAt: Date; reason: SlotDeferReason } | null = null;

    for (let index = 0; index < cands.length; index++) {
        const c = cands[index];
        if (seen.has(c.id)) continue;
        seen.add(c.id);

        const d = decideSlot(c.settings, now, c.usage);
        if (d.ok) {
            const t = c.usage.lastSentAt ? c.usage.lastSentAt.getTime() : NaN;
            passed.push({ id: c.id, index, lastMs: Number.isFinite(t) ? t : -Infinity });
            continue;
        }
        // 같은 시각이면 묶음 앞쪽을 남긴다 (< 로 비교)
        if (d.reason === "paused") {
            if (!paused || d.retryAt.getTime() < paused.retryAt.getTime()) paused = d;
        } else if (!blocked || d.retryAt.getTime() < blocked.retryAt.getTime()) {
            blocked = d;
        }
    }

    const pick = blocked ?? paused;
    if (passed.length > 0 || pick === null) {
        passed.sort((a, b) => {
            if (a.lastMs !== b.lastMs) return a.lastMs < b.lastMs ? -1 : 1;
            return a.index - b.index;
        });
        return { ok: true, order: passed.map((p) => p.id) };
    }
    return { ok: false, retryAt: new Date(pick.retryAt.getTime()), reason: pick.reason };
}

// ============================================
// 간격 미룸 펼치기
// ============================================

/**
 * 묶음이 간격(spacing) 때문에 막혔을 때, 이 묶음이 한 통씩 더 보낼 수 있게 되는 평균 간격 (ms). 0 = 펼치지 않는다.
 *
 * 간격에 막힌 주소마다 1/간격을 더해 뒤집는다 — 주소 m개가 각자 g마다 보내면 묶음은 g/m마다 한 통이다.
 * 주소 하나의 간격으로 펼치면 묶음이 보낼 수 있는 양보다 늦게 깨워 발송이 느려진다.
 * 오늘 시간대 안에서 다시 열리는 주소(retryAt = 마지막 발송 + 간격)만 센다 — 시간대 끝을 넘겨 다음 날로 밀린 주소,
 * 한도·정지·시간대에 막힌 주소는 오늘 더 보내지 못하니 묶음 속도에 들어가지 않는다.
 */
export function poolSpacingStepMs(cands: readonly PoolCandidate[], now: Date): number {
    const today = kstParts(now).date;
    const seen = new Set<number>();
    let perMs = 0;
    for (const c of cands) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const d = decideSlot(c.settings, now, c.usage);
        if (d.ok || d.reason !== "spacing" || !c.usage.lastSentAt) continue;
        const gap = spreadGapMs(c.settings, capForDate(c.settings, today));
        if (gap <= 0 || d.retryAt.getTime() !== c.usage.lastSentAt.getTime() + gap) continue;
        perMs += 1 / gap;
    }
    return perMs > 0 ? Math.max(1, Math.floor(1 / perMs)) : 0;
}

/** spreadSpacingRetry가 "(묶음, retryAt)마다 몇 통을 이미 그 시각 뒤로 나눠 줬는지" 적어 두는 곳 */
export type SpacingSpreadMemo = Map<string, { baseMs: number; count: number }>;

/**
 * 같은 묶음에서 같은 retryAt으로 미뤄지는 메일을 순번 × 간격(stepMs)으로 펼친다. 늘 새 Date를 준다.
 *
 * 간격 retryAt은 "마지막 발송 + 간격" 하나라서, 막힌 메일이 전부 같은 시각에 깨어나면 한 통만 나가고
 * 나머지는 다시 같은 시각으로 미뤄진다 — 대기열이 간격마다 밀린 줄 전부를 다시 처리하게 된다.
 * 펼쳐 두면 줄마다 제 차례쯤 한 번 깨어난다. 묶음 속도보다 촘촘하게(시간대 공백을 무시하고) 펼치므로
 * 제 차례보다 늦게 깨는 일은 없고, 너무 일찍 깬 줄은 그때 다시 간격으로 미뤄진다.
 *
 * memo는 같은 프로세스 안에서만 이어진다 (재시작·다른 인스턴스는 0번부터 다시 센다 — 몰림이 조금 남을 뿐 틀리지 않는다).
 * 이미 지난 retryAt의 기록은 버린다 — 간격 retryAt은 늘 미래라 같은 키가 다시 오지 않는다.
 */
export function spreadSpacingRetry(
    memo: SpacingSpreadMemo,
    poolKey: string,
    retryAt: Date,
    stepMs: number,
    now: Date,
): Date {
    const nowMs = now.getTime();
    for (const [key, entry] of memo) {
        if (entry.baseMs <= nowMs) memo.delete(key);
    }
    const baseMs = retryAt.getTime();
    if (!(stepMs > 0) || !(baseMs > nowMs)) return new Date(baseMs);

    const key = `${poolKey}|${baseMs}`;
    const entry = memo.get(key) ?? { baseMs, count: 0 };
    const spread = new Date(baseMs + entry.count * stepMs);
    entry.count++;
    memo.set(key, entry);
    return spread;
}

// ============================================
// 발신 주소 묶음 (AI 규칙)
// ============================================

/** 양의 정수만 남기고 중복을 뺀다 (처음 나온 순서 유지). Set이 넣은 순서를 지키므로 O(n)이다 */
function uniquePositiveInts(values: readonly unknown[]): number[] {
    const seen = new Set<number>();
    for (const v of values) {
        if (isPositiveInt(v)) seen.add(v);
    }
    return [...seen];
}

/**
 * 규칙의 발신 주소 묶음. sender_profile_ids가 있으면 그것(순서 유지), 없으면 옛 칸 sender_profile_id 하나.
 * 비어 있으면 호출한 쪽이 기본 주소를 쓴다. jsonb라 숫자가 아닌 값이 섞여 있을 수 있어 걸러 낸다.
 */
export function linkSenderPool(link: {
    senderProfileId: number | null;
    senderProfileIds: number[] | null;
}): number[] {
    const ids = Array.isArray(link.senderProfileIds) ? uniquePositiveInts(link.senderProfileIds) : [];
    if (ids.length > 0) return ids;
    return isPositiveInt(link.senderProfileId) ? [link.senderProfileId] : [];
}

/**
 * API 입력 검사. 배열(또는 null)만 받는다. 양의 정수만, 중복 제거, 순서 유지, 최대 50개. 빈 배열 → ids:null.
 * 배열 길이(MAX_SENDER_POOL_INPUT)를 다른 무엇보다 먼저 본다 — 소유 확인보다 앞에서 도는 함수라 큰 입력을 바로 끊는다.
 */
export function normalizeSenderPool(
    input: unknown,
): { ok: true; ids: number[] | null } | { ok: false; error: string } {
    if (input === null) return { ok: true, ids: null };
    if (!Array.isArray(input)) {
        return { ok: false, error: "발신 주소 묶음은 목록(배열)이어야 합니다." };
    }
    if (input.length > MAX_SENDER_POOL_INPUT) {
        return { ok: false, error: `발신 주소는 최대 ${MAX_SENDER_POOL_SIZE}개까지 묶을 수 있습니다.` };
    }
    if (!input.every(isPositiveInt)) {
        return { ok: false, error: "발신 주소 id는 양의 정수여야 합니다." };
    }
    const ids = uniquePositiveInts(input);
    if (ids.length > MAX_SENDER_POOL_SIZE) {
        return { ok: false, error: `발신 주소는 최대 ${MAX_SENDER_POOL_SIZE}개까지 묶을 수 있습니다.` };
    }
    return { ok: true, ids: ids.length > 0 ? ids : null };
}

// ============================================
// 저장 검증
// ============================================

export type SettingsValidation =
    | { ok: true; value: SenderLimitSettings }
    | { ok: false; error: string };

const INT_FIELDS = [
    ["dailyLimit", 1, 100000, "하루 최대 발송 수"],
    ["warmupStartCount", 1, 100000, "웜업 첫날 발송 수"],
    ["warmupStep", 0, 100000, "웜업 하루 증가 수"],
    ["sendWindowStart", 0, 23, "발송 시작 시각"],
    ["sendWindowEnd", 1, 24, "발송 종료 시각"],
] as const;

const BOOL_FIELDS = [
    ["warmupEnabled", "웜업 사용"],
    ["weekdaysOnly", "평일만 보내기"],
    ["spreadEvenly", "고르게 나눠 보내기"],
    ["isPaused", "일시 정지"],
] as const;

/**
 * 화면·API에서 받은 한도 칸(patch)을 현재 값(current)에 합친 **결과**를 검증한다.
 *
 * patch만 보면 "시작 시각만 바꿔 끝보다 늦어짐", "웜업 중인데 하루 최대만 비움"이 통과한다.
 * patch의 다른 칸(name 등)과 warmupStartedOn은 무시한다 — 웜업 시작일은 서버가 정한다.
 * todayYmd는 KST 오늘 (kstParts(now).date). toISOString()을 쓰면 00~09시 KST에 하루 어긋난다.
 */
export function validateLimitSettings(
    patch: Record<string, unknown>,
    current: SenderLimitSettings,
    todayYmd: string,
): SettingsValidation {
    const next: SenderLimitSettings = { ...current };

    for (const [key, min, max, label] of INT_FIELDS) {
        const raw = patch[key];
        if (raw === undefined) continue;
        const p = parseInteger(raw);
        if (!p.ok || (p.value !== null && (p.value < min || p.value > max))) {
            return { ok: false, error: `${label}${topicParticle(label)} ${min}~${max} 사이 정수여야 합니다.` };
        }
        next[key] = p.value;
    }

    for (const [key, label] of BOOL_FIELDS) {
        const raw = patch[key];
        if (raw === undefined) continue;
        const p = parseBoolean(raw);
        if (!p.ok) {
            return { ok: false, error: `${label}${topicParticle(label)} true 또는 false여야 합니다.` };
        }
        next[key] = p.value;
    }

    const start = next.sendWindowStart;
    const end = next.sendWindowEnd;
    if ((start === null) !== (end === null)) {
        return { ok: false, error: "발송 시간대는 시작 시각과 종료 시각을 함께 정해야 합니다." };
    }
    if (start !== null && end !== null && end <= start) {
        return { ok: false, error: "발송 종료 시각은 시작 시각보다 늦어야 합니다." };
    }

    if (next.warmupEnabled && next.dailyLimit === null) {
        return { ok: false, error: "웜업을 켜려면 웜업이 멈출 하루 최대 발송 수를 정해야 합니다." };
    }

    if (next.spreadEvenly) {
        if (start === null) {
            return { ok: false, error: "고르게 나눠 보내려면 발송 시간대를 정해야 합니다." };
        }
        if (next.dailyLimit === null && !next.warmupEnabled) {
            return { ok: false, error: "고르게 나눠 보내려면 하루 최대 발송 수나 웜업을 정해야 합니다." };
        }
    }

    // 웜업 시작일: 꺼짐 → 켜짐이면 오늘, 켜짐 → 꺼짐이면 비움. 켜져 있는데 비어 있으면(옛 값) 오늘부터 센다 —
    // 비어 있으면 매일 0일째가 되어 웜업이 오르지 않는다
    if (!next.warmupEnabled) {
        next.warmupStartedOn = null;
    } else if (!current.warmupEnabled || !isValidYmd(next.warmupStartedOn)) {
        next.warmupStartedOn = todayYmd;
    }

    return { ok: true, value: next };
}

// ============================================
// 표시
// ============================================

/** 대기열 last_error에 남길 미룸 사유. 예: "deferred(daily_limit) until 10/3 09:00" (KST) */
export function describeDeferral(reason: SlotDeferReason, retryAt: Date): string {
    return `deferred(${reason}) until ${formatKstShort(retryAt)}`;
}
