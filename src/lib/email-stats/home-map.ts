import type { StatCounts } from "@/components/email/dashboard/types";
import { openRatePercent } from "@/components/email/opens/utils/openRate";
import type { TemplatePerformance, TrendItem } from "@/hooks/useAnalytics";

export function emailSummary(counts: StatCounts) {
    return {
        total: counts.total,
        sent: counts.sent,
        failed: counts.failed,
        pending: counts.pending,
        clicked: counts.clicked,
        clickRate: counts.sent ? Math.round(counts.clicked / counts.sent * 1000) / 10 : 0,
        opened: counts.opened,
        openBase: counts.openBase,
        openRate: openRatePercent(counts.opened, counts.openBase)
    };
}

export function triggerSummary(trigger: string, counts: StatCounts) {
    const { pending, ...summary } = emailSummary(counts);
    void pending;
    return {
        triggerType: trigger || "unknown",
        ...summary,
        successRate: counts.total ? Math.round(counts.sent / counts.total * 1000) / 10 : 0
    };
}

export function templateSummary(kind: string, name: string, counts: StatCounts): TemplatePerformance | null {
    if (kind !== "ai" && kind !== "template")
        return null;
    const { pending, ...summary } = emailSummary(counts);
    void pending;
    return {
        ...summary,
        name: kind === "ai" && name !== "(삭제됨)" ? `AI: ${name}` : name,
        channel: "email",
        type: kind === "ai" ? "ai_auto" : "link",
        successRate: counts.total ? Math.round(counts.sent / counts.total * 100) : 0
    };
}

export function mergeHomeTrends(email: (StatCounts & {
    date: string;
})[], alimtalk: {
    date: string;
    sent: number;
    failed: number;
}[]): TrendItem[] {
    const rows = new Map<string, TrendItem>();
    const empty = (date: string): TrendItem => ({
        date,
        alimtalkSent: 0,
        alimtalkFailed: 0,
        emailSent: 0,
        emailFailed: 0,
        emailClicked: 0,
        emailOpened: 0
    });
    for (const row of alimtalk)
        rows.set(row.date, { ...empty(row.date), alimtalkSent: row.sent, alimtalkFailed: row.failed });
    for (const row of email)
        rows.set(
            row.date,
            {
                ...(rows.get(row.date) ?? empty(row.date)),
                emailSent: row.sent,
                emailFailed: row.failed,
                emailClicked: row.clicked,
                emailOpened: row.opened
            }
        );
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
