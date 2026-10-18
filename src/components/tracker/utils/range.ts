import { isValidYmd } from "@/lib/tracker/date-range";
import type { Range, RangePreset } from "../types/overview";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_DAYS = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

// 달력에서 고른 날짜와 브라우저의 오늘은 로컬 날짜로 읽는다.
export function ymd(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function rangeDays(range: Pick<Range, "from" | "to">): number {
    return (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS + 1;
}

export function presetRange(preset: RangePreset, now = new Date()): Range {
    const key = preset === "custom" ? "1d" : preset;
    const to = ymd(now);
    return { preset: key, from: addDays(to, 1 - PRESET_DAYS[key]), to };
}

/** 선택한 기간 길이만큼 이동하며, 다음 기간이 미래면 오늘까지의 동일 길이로 맞춘다. */
export function shiftRange(range: Range, direction: -1 | 1, now = new Date()): Range {
    const today = ymd(now);
    if (direction === 1 && range.to >= today) return range;
    const days = rangeDays(range);
    const to = direction === 1 ? [addDays(range.to, days), today].sort()[0] : addDays(range.to, -days);
    return { ...range, from: addDays(to, 1 - days), to };
}

/** 이동한 프리셋은 명시된 날짜를 우선해 복구한다. */
export function rangeFromSearchParams(sp: URLSearchParams, now = new Date()): Range {
    const key = sp.get("preset");
    const preset = key && Object.hasOwn(PRESET_DAYS, key) ? key as keyof typeof PRESET_DAYS : null;
    const from = sp.get("from");
    const to = sp.get("to");
    if (from && to && isValidYmd(from) && isValidYmd(to) && from <= to) {
        return { preset: preset && rangeDays({ from, to }) === PRESET_DAYS[preset] ? preset : "custom", from, to };
    }
    return presetRange(preset ?? "1d", now);
}

export function rangeSearchParams(range: Range, current: URLSearchParams, now = new Date()): URLSearchParams {
    const next = new URLSearchParams(current);
    if (range.preset === "custom") next.delete("preset");
    else next.set("preset", range.preset);
    const latest = presetRange(range.preset, now);
    if (range.preset !== "custom" && range.from === latest.from && range.to === latest.to) {
        next.delete("from");
        next.delete("to");
    } else {
        next.set("from", range.from);
        next.set("to", range.to);
    }
    return next;
}
