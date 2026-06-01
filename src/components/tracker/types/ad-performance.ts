// 광고 그룹별 전환 성과 — 광고 단위 visitor 모수 × funnel 전환 단계 도달.

export interface AdPerformanceRow {
    key: string;            // 광고 그룹 식별 키
    platform: "meta" | "google" | "naver";
    label: string;          // 표시용 라벨
    visitors: number;       // 이 광고로 유입된 distinct visitor (기간 내 코호트)
    conversions: number;    // 그중 전환 단계 도달 visitor
    conversionRate: number; // conversions / visitors (0~1)
}

export interface AdPerformanceData {
    funnel: { id: number | null; name: string | null; conversionLabel: string | null };
    range: { from: string; to: string };
    rows: AdPerformanceRow[];
}

export type AdPerformanceResponse =
    | { success: true; data: AdPerformanceData }
    | { success: false; error: string };
