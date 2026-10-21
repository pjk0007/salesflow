import type { CoverageStatus, StatCounts, StatRates } from "@/components/email/dashboard/types";
import { openRatePercent } from "@/components/email/opens/utils/openRate";
import { addDaysYmd } from "../kst";
import { kstToday, type DateRange } from "./rules";
export const STAT_COUNT_KEYS = [
    "total", "accepted", "sent", "failed", "pending", "delivered", "bounced", "bouncedHard",
    "senderSide", "nhnUnsub", "sendReject", "unconfirmed", "openBase", "opened", "clicked",
    "openedClicked", "replied", "autoReplied", "firstAccepted", "firstSent", "seqReplied",
    "unsubscribed", "complained", "visited", "siteActions",
] as const;
export const ratePercent = openRatePercent;

export function emptyCounts(): StatCounts {
    return Object.fromEntries(STAT_COUNT_KEYS.map(key => [key, 0])) as StatCounts;
}

export function sumCounts(rows: readonly StatCounts[]): StatCounts {
    const sum = emptyCounts();
    for (const row of rows)
        for (const key of STAT_COUNT_KEYS)
            sum[key] += row[key];
    return sum;
}

export function deriveRates(counts: StatCounts): StatRates {
    const confirmed = counts.delivered + counts.bounced + counts.senderSide + counts.nhnUnsub;
    return {
        deliveryRate: ratePercent(counts.delivered, confirmed),
        bounceRate: ratePercent(counts.bounced, confirmed),
        senderSideRate: ratePercent(counts.senderSide, confirmed),
        openRate: ratePercent(counts.opened, counts.openBase),
        clickRate: ratePercent(counts.clicked, counts.sent),
        ctor: ratePercent(counts.openedClicked, counts.opened),
        replyRate: ratePercent(counts.seqReplied, counts.firstSent),
        replyRatePerSend: ratePercent(counts.replied, counts.sent),
        unsubscribeRate: ratePercent(counts.unsubscribed, counts.sent),
        visitRate: ratePercent(counts.visited, counts.sent),
    };
}
/** 비율 지표는 반올림 전의 값을 전달한다. 비교값 0 또는 미연동 값은 null이다. */
export function deltaPct(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous === 0)
        return null;
    return Math.round((current - previous) / previous * 1000) / 10 || 0;
}

export function coverageStatus(range: DateRange, coverage: {
    from: string | null;
    to: string;
} | null): CoverageStatus {
    if (!coverage || coverage.to < range.from || (coverage.from !== null && coverage.from > range.to))
        return "none";
    return (coverage.from === null || coverage.from <= range.from) && coverage.to >= range.to ? "full" : "partial";
}

export function isMaturing(date: string, now: Date): boolean {
    const today = kstToday(now);
    return date >= addDaysYmd(today, -2) && date <= today;
}
