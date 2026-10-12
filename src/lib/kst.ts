/**
 * 한국 시각(KST) 계산 — 순수 함수만.
 *
 * 서버는 UTC로 돈다. toLocaleString(timeZone) 대신 +9시간 고정 계산을 쓰는 것은
 * 한국에 서머타임이 없어 이것으로 충분하고, Intl 데이터가 빠진 런타임에서도 같은 값이 나오게 하려는 것이다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 18;

export interface KstParts {
    /** "YYYY-MM-DD" */
    date: string;
    hour: number;
    minute: number;
    /** 0 = 일요일 … 6 = 토요일 */
    weekday: number;
}

function shifted(date: Date): Date {
    return new Date(date.getTime() + KST_OFFSET_MS);
}

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

export function kstParts(now: Date): KstParts {
    const s = shifted(now);
    return {
        date: s.toISOString().slice(0, 10),
        hour: s.getUTCHours(),
        minute: s.getUTCMinutes(),
        weekday: s.getUTCDay(),
    };
}

/** KST 날짜·시각 → Date. 예: ("2026-10-05", 9) → 2026-10-05T00:00:00Z */
export function kstToDate(ymd: string, hour: number, minute = 0): Date {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, hour, minute) - KST_OFFSET_MS);
}

/** 날짜 문자열에 n일을 더한다 (달·해 넘김 포함) */
export function addDaysYmd(ymd: string, n: number): string {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = 일요일 … 6 = 토요일 */
export function weekdayOfYmd(ymd: string): number {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWeekdayYmd(ymd: string): boolean {
    const w = weekdayOfYmd(ymd);
    return w >= 1 && w <= 5;
}

/** ymd 다음 날부터 세어 처음 오는 평일 (금요일 → 월요일). 공휴일은 모른다 */
export function nextWeekdayYmd(ymd: string): string {
    let next = addDaysYmd(ymd, 1);
    while (!isWeekdayYmd(next)) next = addDaysYmd(next, 1);
    return next;
}

/** "M/D HH:mm" — 월·일은 앞 0 없이, 시·분은 두 자리 */
export function formatKstShort(date: Date): string {
    const s = shifted(date);
    return `${s.getUTCMonth() + 1}/${s.getUTCDate()} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`;
}

/** "HH:mm" */
export function formatKstHm(date: Date): string {
    const s = shifted(date);
    return `${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`;
}

/** 평일 09:00 이상 18:00 미만 (KST) */
export function isBusinessHours(now: Date): boolean {
    const p = kstParts(now);
    if (p.weekday < 1 || p.weekday > 5) return false;
    return p.hour >= BUSINESS_START_HOUR && p.hour < BUSINESS_END_HOUR;
}

/** 근무시간이면 now 그대로, 아니면 다음 근무 시작 (평일 09:00 전이면 그날 09:00) */
export function nextBusinessStart(now: Date): Date {
    if (isBusinessHours(now)) return new Date(now.getTime());
    const p = kstParts(now);
    if (isWeekdayYmd(p.date) && p.hour < BUSINESS_START_HOUR) {
        return kstToDate(p.date, BUSINESS_START_HOUR);
    }
    return kstToDate(nextWeekdayYmd(p.date), BUSINESS_START_HOUR);
}
