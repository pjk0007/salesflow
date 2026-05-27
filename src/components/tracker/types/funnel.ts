// 사이트별 사용자정의 퍼널 — 트래커 코드에 도메인 단어를 박지 않고 사이트가 자기 단계를 정의.

export type StageMatch =
    | { type: "record_event"; eventType: string; label?: string }
    | { type: "record_field"; field: string; value: string }
    | { type: "page_url"; pathPrefix: string };

export interface FunnelStage {
    key: string;        // 내부 slug (응답/식별용)
    label: string;      // 화면 표시
    match: StageMatch;
}

export interface FunnelDefinition {
    id: number;
    siteId: number;
    name: string;
    stages: FunnelStage[];   // 3단부터 (visit/lead는 자동)
    isDefault: number;       // 0 | 1
    createdAt: string;
    updatedAt: string;
}

// 분석 응답
export interface FunnelStageResult {
    key: string;
    label: string;
    visitors: number;        // 그 단계 통과한 distinct visitor 수 (기간 내 첫 발생 기준)
    isAuto?: boolean;        // visit/lead 자동 단계 여부
}

export interface FunnelAnalyticsData {
    funnel: { id: number | null; name: string | null };
    range: { from: string; to: string };
    stages: FunnelStageResult[];
}

export type FunnelAnalyticsResponse =
    | { success: true; data: FunnelAnalyticsData }
    | { success: false; error: string };

export type FunnelsListResponse =
    | { success: true; data: FunnelDefinition[] }
    | { success: false; error: string };

export type FunnelMutateResponse =
    | { success: true; data: FunnelDefinition }
    | { success: false; error: string };

// 편집기에서 드롭다운으로 보여줄 사이트별 옵션
export interface FunnelOptions {
    eventTypes: Array<{ type: string; labels: string[] }>;
    selectFields: Array<{ key: string; label: string; options: string[] }>;
    popularPaths: string[];
}

export type FunnelOptionsResponse =
    | { success: true; data: FunnelOptions }
    | { success: false; error: string };
