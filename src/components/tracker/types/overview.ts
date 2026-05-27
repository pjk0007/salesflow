// 트래커 개요 탭 응답 타입 — /api/tracker/analytics/overview

export type RangePreset = "7d" | "30d" | "90d" | "custom";

export interface Range {
    from: string; // YYYY-MM-DD (KST 자정 기준)
    to: string;
    preset: RangePreset;
}

export interface KpiMetric {
    value: number;
    deltaPct: number | null; // 직전 동일 기간 대비 ±%, prev=0이면 null
}

export interface OverviewData {
    range: { from: string; to: string };
    kpi: {
        visitors: KpiMetric;
        sessions: KpiMetric;
        pageviews: KpiMetric;
        avgDwellSec: KpiMetric;
        bounceRate: KpiMetric; // 0~1
        leadRate: KpiMetric;   // record 연결 visitor 비율
        signupRate: KpiMetric; // signup record_event 발생 visitor 비율
    };
    dailyPageviews: Array<{ date: string; count: number }>;
    popularPages: Array<{ path: string; title: string | null; views: number }>;
    recentSessions: Array<{
        id: number;
        visitorId: number;
        visitorEmail: string | null;
        visitorAnonId: string;
        landingPath: string | null;
        channel: string;
        pageCount: number;
        startedAt: string;
    }>;
    inflowChannels: Array<{ channel: string; sessions: number }>;
    devices: {
        types: Array<{ name: string; count: number }>;
        browsers: Array<{ name: string; count: number }>;
        oss: Array<{ name: string; count: number }>;
    };
}

export type OverviewResponse =
    | { success: true; data: OverviewData }
    | { success: false; error: string };
