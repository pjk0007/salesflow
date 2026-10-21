import type { STAT_COUNT_KEYS } from "@/lib/email-stats/metrics";
export type StatCounts = Record<(typeof STAT_COUNT_KEYS)[number], number>;
export interface StatRates {
    deliveryRate: number | null;
    bounceRate: number | null;
    senderSideRate: number | null;
    openRate: number | null;
    clickRate: number | null;
    ctor: number | null;
    replyRate: number | null;
    replyRatePerSend: number | null;
    unsubscribeRate: number | null;
    visitRate: number | null;
}
export type CompareAxis = "campaign" | "step" | "partition" | "sender" | "domain" | "trigger" | "date";
export type CoverageStatus = "full" | "partial" | "none";
export interface StatsQuery {
    from: string;
    to: string;
    workspaceId: number | null;
}
export interface StatsEnvelope {
    range: {
        from: string;
        to: string;
        days: number;
    };
    comparison: {
        from: string;
        to: string;
    };
    asOf: string | null;
    coverage: {
        from: string | null;
        to: string;
    } | null;
    connections: {
        reply: boolean;
        site: boolean;
        journey: boolean;
    };
}
export type KpiKey = "sent" | "deliveryRate" | "openRate" | "clickRate" | "visits" | "replyRate" | "keyLeads" | "unsubscribeRate";
export interface KpiValue {
    value: number | null;
    comparison: number | null;
    deltaPct: number | null;
}
export interface KpiData extends StatsEnvelope {
    current: StatCounts;
    previous: StatCounts;
    rates: StatRates;
    currentCoverage: CoverageStatus;
    previousCoverage: CoverageStatus;
    leads: {
        total: number;
        urgent: number;
        highlight: number;
        unhandled: number;
        previousTotal: number;
    };
    kpi: Record<KpiKey, KpiValue>;
}
export interface TrendData extends StatsEnvelope {
    points: Array<{
        date: string;
        counts: StatCounts;
        rates: StatRates;
        ready: boolean;
        maturing: boolean;
    }>;
}
export interface CompareRow {
    key: string;
    label: string;
    sublabel: string | null;
    deleted: boolean;
    counts: StatCounts;
    rates: StatRates;
}
export interface CompareData extends StatsEnvelope {
    axis: CompareAxis;
    replyBasis: "sequence" | "perSend";
    currentCoverage: CoverageStatus;
    rows: CompareRow[];
    total: CompareRow;
    restCount: number;
}
