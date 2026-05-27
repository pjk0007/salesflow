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

export type DeviceFilter = "desktop" | "mobile" | "tablet" | null;
export type ChannelFilter = string | null; // classifyInflow 결과 라벨

export interface SegmentFilters {
    device: DeviceFilter;
    channel: ChannelFilter;
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
    exitPages: Array<{ path: string; title: string | null; exits: number }>;
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
    // 채널별 전환: 어디서 온 트래픽이 가장 잘 전환되나 (광고비 재분배 결정용)
    channelConversions: Array<{ channel: string; visitors: number; leads: number; leadRate: number }>;
    // 일별 가입/구독 추이 — PV 차트와 보조로 "왜 이번 기간 전환이 변했나" 보기 위함
    dailyConversions: Array<{ date: string; signups: number; paid: number }>;
    // 간단 퍼널 — 방문자→리드→가입→결제(전환완료). paid는 site.conversionStage가 설정됐을 때만, 아니면 null
    funnel: { visitors: number; leads: number; signups: number; paid: number | null; conversionStageLabel: string | null };
    adContents: Array<{
        content: string;
        sessions: number;
        leads: number;
        leadRate: number;
        source: string | null;
        medium: string | null;
        campaign: string | null;
    }>;
    devices: {
        types: Array<{ name: string; count: number }>;
        browsers: Array<{ name: string; count: number }>;
        oss: Array<{ name: string; count: number }>;
    };
}

export type OverviewResponse =
    | { success: true; data: OverviewData }
    | { success: false; error: string };
