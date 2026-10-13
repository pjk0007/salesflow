import { createHash } from "node:crypto";
import { addDaysYmd, isWeekdayYmd, kstParts, kstToDate } from "./kst";
import { capForDate, inboundReserve, reserveReleaseHour } from "./email-sender-limit-rules";
import type { SenderLimitSettings } from "./email-sender-limit-rules";

export const PREPARATION_LEAD_MS = 2 * 60 * 1000;
export const DELIVERY_GRACE_MS = 2 * 60 * 1000;

function dailySchedule(settings: SenderLimitSettings, date: string, plannedStart?: Date) {
    const cap = capForDate(settings, date);
    if (cap === null || cap <= 0) return null;
    const start = Math.max(kstToDate(date, settings.sendWindowStart ?? 9).getTime(), plannedStart?.getTime() ?? 0);
    const end = kstToDate(date, settings.sendWindowEnd ?? 18).getTime();
    if (start >= end) return null;
    const reserve = inboundReserve(cap);
    const regular = cap - reserve;
    const reserveStart = reserve === 0 ? end : Math.max(
        end - (end - start) * reserve / cap,
        kstToDate(date, reserveReleaseHour(settings)).getTime(),
    );
    return { cap, start, end, reserve, regular, reserveStart };
}

function slotAt(profileId: number, date: string, plan: NonNullable<ReturnType<typeof dailySchedule>>, ordinal: number) {
    const { cap, start, end, reserve, regular, reserveStart } = plan;
    if (ordinal < 0 || ordinal >= cap) throw new Error("예약 순번이 하루 한도를 벗어났습니다.");
    const reserved = ordinal >= regular;
    const count = reserved ? reserve : regular;
    const index = reserved ? ordinal - regular : ordinal;
    const from = reserved ? reserveStart : start;
    const to = reserved ? end : reserveStart;
    const width = (to - from) / count;
    const hash = createHash("sha256").update(`${profileId}:${date}:${ordinal}`).digest().readUInt32BE(0);
    const jitter = 0.2 + (hash / 0x1_0000_0000) * 0.6;
    return new Date(Math.floor(from + width * (index + jitter)));
}

/** 날짜·주소마다 다른 예약표. 재시작해도 유지되며 각 구간의 중앙 60%에서 시각을 고른다. */
export function randomDailySlots(profileId: number, settings: SenderLimitSettings, date: string, plannedStart?: Date): Date[] {
    const plan = dailySchedule(settings, date, plannedStart);
    return plan ? Array.from({ length: plan.cap }, (_, ordinal) => slotAt(profileId, date, plan, ordinal)) : [];
}

/** 큰 하루 한도도 전체 예약표를 매번 만들지 않고 이진 탐색으로 다음 빈 구간을 찾는다. */
export function nextRandomDailySlot(profileId: number, settings: SenderLimitSettings, date: string, plannedStart: Date, earliest: Date, occupied: Set<number>) {
    const plan = dailySchedule(settings, date, plannedStart);
    if (!plan) return null;
    let low = 0;
    let high = plan.cap;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (slotAt(profileId, date, plan, middle) < earliest) low = middle + 1;
        else high = middle;
    }
    while (low < plan.cap && occupied.has(low)) low++;
    return low < plan.cap ? { ordinal: low, scheduledAt: slotAt(profileId, date, plan, low) } : null;
}

/** 이미 지난 예약은 몰아서 따라잡지 않는다. 남은 구간이 없으면 다음 발송일에 다시 준비한다. */
export function nextPreparationAt(settings: SenderLimitSettings, now: Date): Date {
    let date = addDaysYmd(kstParts(now).date, 1);
    while (settings.weekdaysOnly && !isWeekdayYmd(date)) date = addDaysYmd(date, 1);
    return kstToDate(date, Math.max(0, (settings.sendWindowStart ?? 9) - 1));
}

export function preparedSourceHash(data: unknown, link: unknown): string {
    const source = { ...(data as Record<string, unknown>) };
    delete source._companyResearch; // 준비 중 저장하는 조사 결과 때문에 같은 메일을 다시 생성하지 않는다.
    return createHash("sha256").update(JSON.stringify({ data: source, link })).digest("hex");
}

export function isDeliveryDue(scheduledAt: Date, now: Date): boolean {
    const lateness = now.getTime() - scheduledAt.getTime();
    return lateness >= 0 && lateness <= DELIVERY_GRACE_MS;
}

/** 지연된 예약이 같은 회차에 모여도 한 주소에서 연속 전송하지 않는다. */
export function preparedMinimumGapMs(settings: SenderLimitSettings, date: string): number {
    const cap = capForDate(settings, date);
    if (!cap || cap < 1) return 30_000;
    const hours = (settings.sendWindowEnd ?? 18) - (settings.sendWindowStart ?? 9);
    return Math.min(30_000, Math.max(1_000, Math.floor(hours * 60 * 60 * 1000 / cap / 4)));
}
