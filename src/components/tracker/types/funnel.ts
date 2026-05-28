// 사이트별 사용자정의 퍼널 — 트래커 코드에 도메인 단어를 박지 않고 사이트가 자기 단계를 정의.

/**
 * 단계 매칭 정의.
 * - "record_field": 필드 값 매칭. 시스템이 자동으로
 *     ① records.data[field] === value (현재 상태)
 *     ② OR record_events에 (type=field, label=value) (변경 이력)
 *   둘 중 하나라도 맞으면 통과. 트래커 도입 전 record와 신규 record를 모두 잡음.
 * - "page_url": 특정 페이지 경로 방문 여부.
 */
export type StageMatch =
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
    // 사이트가 가진 추적 ON 필드들 + record_events에 있는 (type,label) 쌍 평탄화
    eventTypes: Array<{ type: string; labels: string[] }>;
    // 인기 페이지 경로 (page_url 매칭용)
    popularPaths: string[];
}

export type FunnelOptionsResponse =
    | { success: true; data: FunnelOptions }
    | { success: false; error: string };
