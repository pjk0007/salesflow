/**
 * 발송 한도 입력 칸 ↔ 저장 값 변환. 순수 함수만 — 시험이 이 파일만 불러도 되게 한다.
 *
 * 검증은 서버와 같은 validateLimitSettings를 그대로 쓴다. 화면이 따로 규칙을 만들면
 * "화면은 통과했는데 저장이 막히는" 어긋남이 생긴다.
 */
import {
    capForDate,
    capSchedule,
    DEFAULT_WARMUP_START,
    DEFAULT_WARMUP_STEP,
    spreadGapMs,
    validateLimitSettings,
    warmupDayIndex,
    type SenderLimitSettings,
    type SettingsValidation,
} from "@/lib/email-sender-limit-rules";
import { BUSINESS_END_HOUR, BUSINESS_START_HOUR, isWeekdayYmd, kstParts, weekdayOfYmd } from "@/lib/kst";
import type { LimitField, SenderLimitForm, SenderLimitPatch, WarmupAutoFill } from "../types";

/**
 * 웜업을 켤 때 하루 최대가 비어 있으면 채우는 값. 첫날 10통·하루 5통씩이면 9일째에 닿는다.
 * 화면 기본값일 뿐이라 사용자가 바꿀 수 있고, 저장하기 전에는 아무 데도 쓰이지 않는다.
 */
export const SUGGESTED_WARMUP_DAILY_LIMIT = 50;

/** 화면이 바꿀 수 있는 한도 칸. warmupStartedOn은 서버가 웜업을 켜는 순간 정한다 */
const EDITABLE_KEYS = [
    "dailyLimit",
    "warmupEnabled",
    "warmupStartCount",
    "warmupStep",
    "sendWindowStart",
    "sendWindowEnd",
    "weekdaysOnly",
    "spreadEvenly",
    "isPaused",
] as const satisfies ReadonlyArray<keyof SenderLimitPatch>;

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function todayKstYmd(now: Date = new Date()): string {
    return kstParts(now).date;
}

function numToText(n: number | null): string {
    return n === null ? "" : String(n);
}

export function limitFormFromSettings(s: SenderLimitSettings): SenderLimitForm {
    const windowEnabled = s.sendWindowStart !== null && s.sendWindowEnd !== null;
    return {
        dailyLimit: numToText(s.dailyLimit),
        warmupEnabled: s.warmupEnabled,
        warmupStartCount: numToText(s.warmupStartCount),
        warmupStep: numToText(s.warmupStep),
        windowEnabled,
        // 시간대를 처음 켤 때는 근무시간(9~18시)을 먼저 채워 둔다
        sendWindowStart: windowEnabled ? (s.sendWindowStart as number) : BUSINESS_START_HOUR,
        sendWindowEnd: windowEnabled ? (s.sendWindowEnd as number) : BUSINESS_END_HOUR,
        weekdaysOnly: s.weekdaysOnly,
        spreadEvenly: s.spreadEvenly,
        isPaused: s.isPaused,
    };
}

/**
 * 입력 칸 → validateLimitSettings에 넘길 patch.
 * 웜업이 꺼져 있으면 숨겨진 첫날·증가 칸은 넣지 않는다 — 보이지 않는 칸 때문에 저장이 막히지 않게 하고, 저장된 값은 그대로 둔다.
 */
export function limitFormToPatch(f: SenderLimitForm): Record<string, unknown> {
    return {
        dailyLimit: f.dailyLimit.trim(),
        warmupEnabled: f.warmupEnabled,
        ...(f.warmupEnabled && {
            warmupStartCount: f.warmupStartCount.trim(),
            warmupStep: f.warmupStep.trim(),
        }),
        sendWindowStart: f.windowEnabled ? f.sendWindowStart : null,
        sendWindowEnd: f.windowEnabled ? f.sendWindowEnd : null,
        weekdaysOnly: f.weekdaysOnly,
        spreadEvenly: f.spreadEvenly,
        isPaused: f.isPaused,
    };
}

/** 저장된 값에 입력을 합쳐 검증한다 (서버 PUT과 같은 계산) */
export function checkLimitForm(f: SenderLimitForm, stored: SenderLimitSettings, todayYmd: string): SettingsValidation {
    return validateLimitSettings(limitFormToPatch(f), stored, todayYmd);
}

/**
 * 검증 문구 → 오류를 붙일 입력 칸. 문구는 서버와 같은 validateLimitSettings가 만든다 —
 * 화면이 규칙을 따로 세우지 않으려고 문구 앞머리로 자리만 찾는다 (시험이 조합마다 자리를 묶어 둔다).
 * "웜업을 켜려면 … 하루 최대 발송 수를 정해야" 는 고칠 곳이 하루 최대 칸이라 그리로 보낸다.
 */
const ERROR_FIELD_PREFIXES: ReadonlyArray<readonly [string, LimitField]> = [
    ["하루 최대 발송 수", "dailyLimit"],
    ["웜업을 켜려면", "dailyLimit"],
    ["웜업 첫날", "warmupStartCount"],
    ["웜업 하루 증가", "warmupStep"],
    ["발송 시작 시각", "window"],
    ["발송 종료 시각", "window"],
    ["발송 시간대", "window"],
    ["고르게 나눠 보내", "spreadEvenly"],
];

export function limitErrorField(message: string): LimitField {
    const hit = ERROR_FIELD_PREFIXES.find(([prefix]) => message.startsWith(prefix));
    return hit ? hit[1] : "general";
}

export type LimitFormCheck =
    | { ok: true; value: SenderLimitSettings }
    | { ok: false; error: string; field: LimitField };

/** checkLimitForm + 오류를 붙일 칸 */
export function inspectLimitForm(f: SenderLimitForm, stored: SenderLimitSettings, todayYmd: string): LimitFormCheck {
    const check = checkLimitForm(f, stored, todayYmd);
    return check.ok ? check : { ok: false, error: check.error, field: limitErrorField(check.error) };
}

/**
 * 웜업 스위치를 켜고 끈다.
 *
 * 켤 때: 빈 숫자 칸만 채운다 — 첫날·하루 증가는 서버 기본값(10·5), 하루 최대는 권장값.
 * 발송 시간대·평일만은 "언제 보내는가"를 바꾸는 설정이라 사용자가 고른 그대로 둔다 (켜 주지 않는다).
 * 이미 정해 둔 칸도 건드리지 않는다. 저장 전이라 사용자가 다 바꿀 수 있다.
 * 끌 때: 켤 때 채운 칸 가운데 그대로인 것만 되돌린다 (고르게 나누기가 켜져 있으면 그것이 기대는 칸은 둔다).
 */
export function applyWarmupToggle(f: SenderLimitForm, on: boolean): SenderLimitForm {
    if (on) {
        const fill: WarmupAutoFill = {
            dailyLimit: f.dailyLimit.trim() === "" ? String(SUGGESTED_WARMUP_DAILY_LIMIT) : null,
            window: null,
            weekdaysOnly: false,
        };
        return {
            ...f,
            warmupEnabled: true,
            // 빈 칸이어도 서버는 같은 기본값을 쓰지만, 무엇으로 시작하는지 보이게 채운다
            warmupStartCount: f.warmupStartCount || String(DEFAULT_WARMUP_START),
            warmupStep: f.warmupStep || String(DEFAULT_WARMUP_STEP),
            dailyLimit: fill.dailyLimit ?? f.dailyLimit,
            warmupAutoFill: fill,
        };
    }

    const fill = f.warmupAutoFill;
    const next: SenderLimitForm = { ...f, warmupEnabled: false, warmupAutoFill: null };
    if (!fill) return next;
    if (fill.dailyLimit !== null && f.dailyLimit === fill.dailyLimit && !f.spreadEvenly) next.dailyLimit = "";
    if (
        fill.window !== null &&
        f.windowEnabled &&
        f.sendWindowStart === fill.window.start &&
        f.sendWindowEnd === fill.window.end &&
        !f.spreadEvenly
    ) {
        next.windowEnabled = false;
    }
    if (fill.weekdaysOnly && f.weekdaysOnly) next.weekdaysOnly = false;
    return next;
}

/**
 * 웜업을 켜며 채운 칸 가운데 아직 그대로인 것 — "하루 최대 50통 · 9~18시 · 평일만".
 * 사용자가 고친 칸은 빠진다. 남은 것이 없으면 null.
 */
export function warmupAutoFillNote(f: SenderLimitForm): string | null {
    const fill = f.warmupAutoFill;
    if (!fill || !f.warmupEnabled) return null;
    const parts: string[] = [];
    if (fill.dailyLimit !== null && f.dailyLimit === fill.dailyLimit) parts.push(`하루 최대 ${fill.dailyLimit}통`);
    if (fill.window !== null && f.windowEnabled && f.sendWindowStart === fill.window.start && f.sendWindowEnd === fill.window.end) {
        parts.push(`${fill.window.start}~${fill.window.end}시`);
    }
    if (fill.weekdaysOnly && f.weekdaysOnly) parts.push("평일만");
    return parts.length > 0 ? parts.join(" · ") : null;
}

function setPatch<K extends keyof SenderLimitPatch>(out: SenderLimitPatch, key: K, value: SenderLimitPatch[K]): void {
    out[key] = value;
}

/**
 * 저장된 값과 달라진 칸만 고른다.
 * 서버는 한도 칸이 하나라도 오면 관리자인지 본다 — 이름만 고칠 때 한도 칸을 함께 보내면 일반 멤버의 수정이 막힌다.
 */
export function changedLimitFields(stored: SenderLimitSettings, next: SenderLimitSettings): SenderLimitPatch {
    const out: SenderLimitPatch = {};
    for (const key of EDITABLE_KEYS) {
        if (stored[key] !== next[key]) setPatch(out, key, next[key]);
    }
    return out;
}

/** "M/D" — 미리보기 칸과 배지에 쓴다 */
export function formatYmdShort(ymd: string): string {
    const [, m, d] = ymd.split("-").map(Number);
    return `${m}/${d}`;
}

export function weekdayLabel(ymd: string): string {
    return WEEKDAY_LABELS[weekdayOfYmd(ymd)];
}

/**
 * 웜업 며칠째인지 사람이 읽는 숫자로. warmupDayIndex는 시작일이 0이라 1을 더해 "1일째"부터 보인다.
 * 웜업이 꺼져 있으면 null.
 */
export function warmupDayNumber(s: SenderLimitSettings, ymd: string): number | null {
    return s.warmupEnabled ? warmupDayIndex(s, ymd) + 1 : null;
}

export type PreviewKind = "cap" | "unlimited" | "off" | "paused";

export interface PreviewCell {
    date: string;
    cap: number | null;
    kind: PreviewKind;
    /** 칸에 보일 글 — "25통", "무제한", "쉼", "정지" */
    text: string;
}

/** 앞으로 days일 하루 한도 미리보기. 평일만이면 주말 칸은 "쉼"으로 보인다 */
export function previewCells(s: SenderLimitSettings, fromYmd: string, days: number = 14): PreviewCell[] {
    return capSchedule(s, fromYmd, days).map(({ date, cap }) => {
        if (s.isPaused) return { date, cap, kind: "paused", text: "정지" };
        if (s.weekdaysOnly && !isWeekdayYmd(date)) return { date, cap, kind: "off", text: "쉼" };
        if (cap === null) return { date, cap, kind: "unlimited", text: "무제한" };
        return { date, cap, kind: "cap", text: `${cap.toLocaleString()}통` };
    });
}

/** 고르게 나눠 보낼 때 오늘 기준 간격 — "약 10분", "약 54초". 간격이 없으면 null */
export function spreadGapLabel(s: SenderLimitSettings, todayYmd: string): string | null {
    const ms = spreadGapMs(s, capForDate(s, todayYmd));
    if (ms <= 0) return null;
    if (ms >= 60_000) return `약 ${Math.round(ms / 60_000)}분`;
    return `약 ${Math.max(1, Math.round(ms / 1000))}초`;
}
