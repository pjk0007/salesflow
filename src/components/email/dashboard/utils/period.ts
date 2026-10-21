import { presetRange } from "@/lib/email-stats/rules";
export const periodRange = presetRange;

export function calendarDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function calendarRange(from: Date, to: Date) {
    return { from: calendarDate(from), to: calendarDate(to) };
}

export function pickerDate(value: string) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
}
