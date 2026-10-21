import { addDaysYmd, isBusinessHours, kstParts } from "../kst";
export interface DateRange {
    from: string;
    to: string;
}
export type BackfillPhase = "priority" | "rest" | "done";

export function kstToday(now: Date): string {
    return kstParts(now).date;
}

export function presetRange(days: number, now: Date): DateRange {
    const to = kstToday(now);
    return { from: addDaysYmd(to, 1 - days), to };
}
/** toIso는 종료일 다음 날 KST 자정으로, 포함하지 않는 경계다. */
export function kstDayBounds(from: string, to: string) {
    return { fromIso: `${from}T00:00:00+09:00`, toIso: `${addDaysYmd(to, 1)}T00:00:00+09:00` };
}

export function recentWindow(now: Date): DateRange {
    return presetRange(8, now);
}

export function nightlyWindow(now: Date): DateRange {
    const today = kstToday(now);
    return { from: addDaysYmd(today, -34), to: addDaysYmd(today, -8) };
}

export function lateCutoff(now: Date): string {
    return addDaysYmd(kstToday(now), -35);
}

export function priorityFloor(now: Date): string {
    return addDaysYmd(kstToday(now), -59);
}

export function nightlyDue(nightlyDate: string | null, now: Date): boolean {
    const { date, hour } = kstParts(now);
    return (nightlyDate === null || nightlyDate < date) && hour >= 1 && !isBusinessHours(now);
}

export function backfillPhase(filledFrom: string, firstSendDate: string | null, now: Date): BackfillPhase {
    if (firstSendDate === null || filledFrom <= firstSendDate)
        return "done";
    return filledFrom > priorityFloor(now) ? "priority" : "rest";
}

export function backfillAllowed(phase: BackfillPhase, now: Date): boolean {
    return phase === "priority" || (phase === "rest" && !isBusinessHours(now));
}

export function nextBackfillChunk(filledFrom: string, firstSendDate: string | null): DateRange | null {
    if (firstSendDate === null || filledFrom <= firstSendDate)
        return null;
    const start = addDaysYmd(filledFrom, -2);
    return {
        from: start < firstSendDate ? firstSendDate : start,
        to: addDaysYmd(filledFrom, -1)
    };
}

export function nightlyChunks(next: string | null, filledFrom: string, now: Date): DateRange[] {
    const window = nightlyWindow(now);
    const floor = filledFrom > window.from ? filledFrom : window.from;
    let to = next !== null && next < window.to ? next : window.to;
    const chunks: DateRange[] = [];
    while (to >= floor) {
        const start = addDaysYmd(to, -2);
        const from = start < floor ? floor : start;
        chunks.push({ from, to });
        to = addDaysYmd(from, -1);
    }
    return chunks;
}

export function mergeDateRanges(dates: readonly string[]): DateRange[] {
    const ranges: DateRange[] = [];
    for (const date of [...new Set(dates)].sort()) {
        const last = ranges.at(-1);
        if (last && addDaysYmd(last.to, 1) === date)
            last.to = date;
        else
            ranges.push({ from: date, to: date });
    }
    return ranges;
}
