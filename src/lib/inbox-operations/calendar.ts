import { z } from "zod";
const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
        const d = new Date(v + "T00:00:00Z");
        return (
            Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
        );
    }, "날짜를 확인해주세요.");
const minute = (value: string) =>
    value === "24:00"
        ? 1440
        : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const calendarInput = z
    .object({
        timezone: z
            .string()
            .max(80)
            .refine((v) => {
                try {
                    new Intl.DateTimeFormat("en", { timeZone: v }).format();
                    return true;
                } catch {
                    return false;
                }
            }, "시간대를 확인해주세요."),
        weekly: z
            .array(
                z
                    .object({
                        day: z.number().int().min(0).max(6),
                        start: clock,
                        end: z.union([clock, z.literal("24:00")]),
                    })
                    .strict()
                    .refine(
                        (v) => minute(v.start) < minute(v.end),
                        "종료 시간은 시작 이후로 정해주세요.",
                    ),
            )
            .min(1)
            .max(21),
        holidays: z.array(date).max(366),
    })
    .strict()
    .superRefine((v, ctx) => {
        for (let day = 0; day < 7; day++) {
            const rows = v.weekly
                .filter((w) => w.day === day)
                .sort((a, b) => minute(a.start) - minute(b.start));
            for (let i = 1; i < rows.length; i++)
                if (minute(rows[i].start) < minute(rows[i - 1].end))
                    ctx.addIssue({
                        code: "custom",
                        message: "업무시간 구간이 겹칩니다.",
                        path: ["weekly"],
                    });
        }
    });
export type BusinessCalendar = z.infer<typeof calendarInput>;
export const defaultCalendar = (): BusinessCalendar => ({
    timezone: "Asia/Seoul",
    weekly: [1, 2, 3, 4, 5].map((day) => ({
        day,
        start: "09:00",
        end: "18:00",
    })),
    holidays: [],
});
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: Date, zone: string) {
    let f = formatters.get(zone);
    if (!f) {
        f = new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
        });
        formatters.set(zone, f);
    }
    return Object.fromEntries(
        f
            .formatToParts(at)
            .filter((p) => p.type !== "literal")
            .map((p) => [p.type, p.value]),
    );
}
export function localDay(at: Date, zone: string) {
    const p = parts(at, zone);
    return `${p.year}-${p.month}-${p.day}`;
}
export function shiftDay(day: string, delta: number) {
    const d = new Date(date.parse(day) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
}
// Resolve wall-clock boundaries using the offsets on both sides of a possible DST change.
// Repeated start uses the earliest instant; repeated end the latest. A missing boundary advances to the next valid wall minute.
export function zonedBoundary(
    day: string,
    value: string,
    zone: string,
    end = false,
): Date {
    if (value === "24:00") {
        day = shiftDay(day, 1);
        value = "00:00";
        end = false;
    }
    const base = Date.parse(date.parse(day) + "T" + value + ":00Z"),
        offsets = new Set<number>();
    for (const hours of [-36, -12, 0, 12, 36]) {
        const probe = new Date(base + hours * 3600000),
            p = parts(probe, zone);
        offsets.add(
            Date.UTC(
                Number(p.year),
                Number(p.month) - 1,
                Number(p.day),
                Number(p.hour),
                Number(p.minute),
                Number(p.second),
            ) - probe.getTime(),
        );
    }
    for (let delta = 0; delta <= 240; delta++) {
        const wall = new Date(base + delta * 60000),
            wantedDay = wall.toISOString().slice(0, 10),
            wantedClock = wall.toISOString().slice(11, 16),
            candidates: number[] = [];
        for (const offset of offsets) {
            const candidate = wall.getTime() - offset,
                p = parts(new Date(candidate), zone);
            if (
                `${p.year}-${p.month}-${p.day}` === wantedDay &&
                `${p.hour}:${p.minute}` === wantedClock
            )
                candidates.push(candidate);
        }
        if (candidates.length)
            return new Date(
                end ? Math.max(...candidates) : Math.min(...candidates),
            );
    }
    throw new Error("업무시간 경계를 계산하지 못했습니다.");
}
function windows(calendar: BusinessCalendar, day: string) {
    if (calendar.holidays.includes(day)) return [];
    const dow = new Date(day + "T00:00:00Z").getUTCDay(),
        rows = calendar.weekly
            .filter((w) => w.day === dow)
            .map((w) => ({
                start: zonedBoundary(day, w.start, calendar.timezone),
                end: zonedBoundary(day, w.end, calendar.timezone, true),
            }))
            .sort((a, b) => a.start.getTime() - b.start.getTime()),
        merged: typeof rows = [];
    for (const row of rows) {
        const last = merged.at(-1);
        if (last && last.end >= row.start) {
            if (row.end > last.end) last.end = row.end;
        } else merged.push(row);
    }
    return merged;
}
export function businessMilliseconds(
    calendar: BusinessCalendar,
    from: Date,
    to: Date,
) {
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()))
        throw new Error("시간을 확인해주세요.");
    if (to <= from) return 0;
    let day = localDay(from, calendar.timezone),
        total = 0;
    const last = localDay(to, calendar.timezone);
    for (let i = 0; i < 36600 && day <= last; i++, day = shiftDay(day, 1))
        for (const w of windows(calendar, day))
            total += Math.max(
                0,
                Math.min(to.getTime(), w.end.getTime()) -
                    Math.max(from.getTime(), w.start.getTime()),
            );
    if (day <= last) throw new Error("업무시간 계산 범위가 너무 큽니다.");
    return total;
}
export function addBusinessMilliseconds(
    calendar: BusinessCalendar,
    from: Date,
    duration: number,
) {
    if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(duration) ||
        duration < 0
    )
        throw new Error("시간을 확인해주세요.");
    if (duration === 0) return new Date(from);
    let day = localDay(from, calendar.timezone),
        left = duration;
    for (let i = 0; i < 3660; i++, day = shiftDay(day, 1))
        for (const w of windows(calendar, day)) {
            const start = Math.max(from.getTime(), w.start.getTime()),
                available = w.end.getTime() - start;
            if (available <= 0) continue;
            if (left <= available) return new Date(start + left);
            left -= available;
        }
    throw new Error("목표 시간을 계산할 업무시간이 부족합니다.");
}
export function businessAvailability(calendar: BusinessCalendar, now: Date) {
    let day = localDay(now, calendar.timezone);
    for (let i = 0; i < 3660; i++, day = shiftDay(day, 1))
        for (const w of windows(calendar, day)) {
            if (now >= w.start && now < w.end)
                return { open: true, nextOpenAt: null };
            if (w.start > now)
                return { open: false, nextOpenAt: w.start.toISOString() };
        }
    return { open: false, nextOpenAt: null };
}
export const reportDates = z
    .object({ from: date, to: date })
    .refine(
        (v) =>
            v.to >= v.from &&
            Date.parse(v.to) - Date.parse(v.from) <= 365 * 86400000,
        "조회 기간은 최대 1년으로 정해주세요.",
    );
