// /api/tracker/analytics/engagement 응답 타입

export interface EngagementPageInfo {
    path: string;
    title: string | null;
    pageviews: number;
}

export interface EngagementSectionStat {
    name: string;
    // 운영자가 설정 탭에서 등록한 한글 라벨. null 또는 빈 문자열이면 UI에서 name으로 fallback.
    label: string | null;
    visitors: number;
    pageviews: number;
    avgDwellMs: number;
    viewRate: number; // 페이지 PV 대비 시인율 (0~1)
}

export interface EngagementClickStat {
    name: string;
    label: string | null;
    section: string | null;
    clicks: number;
    visitors: number;
    clickRate: number; // 페이지 PV 대비 (0~1)
}

export interface EngagementData {
    range: { from: string; to: string };
    page: string | null; // path prefix 필터 (null = 사이트 전체)
    pages: EngagementPageInfo[];
    sections: EngagementSectionStat[];
    clicks: EngagementClickStat[];
}

export type EngagementResponse =
    | { success: true; data: EngagementData }
    | { success: false; error: string };
