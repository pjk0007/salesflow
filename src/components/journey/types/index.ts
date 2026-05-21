// 고객 여정 — 통합 이벤트/요약 타입

export type JourneySource = "business" | "tracker" | "email";

export interface JourneyEvent {
    at: string; // ISO 시각 (정렬 기준)
    source: JourneySource;
    channel: string; // '단계' | '상태' | '상담' | '사이트' | '메일' 등
    type: string;
    label: string;
    meta: Record<string, unknown>;
    // 세션 묶음(사이트 방문)일 때
    children?: JourneyEvent[];
    groupCount?: number;
}

export interface StageDuration {
    from: string;
    to: string;
    days: number;
}

export interface JourneyDensity {
    visits: number;
    emailSent: number;
    emailClicks: number;
    emailClickRate: number; // 0~1
    avgDwellSec: number;
    sessions: number;
}

export interface JourneyInactivity {
    lastActiveAt: string | null;
    daysSince: number;
    isStale: boolean;
}

export interface JourneyDailyActivity {
    date: string; // YYYY-MM-DD
    count: number;
}

export interface JourneySummary {
    firstSeenAt: string | null;
    convertedAt: string | null;
    daysToConvert: number | null;
    totalEvents: number;
    currentStage: string | null;
    stages: string[]; // 정의된 퍼널 순서
    reachedStages: string[]; // 실제 도달한 단계
    stageDurations: StageDuration[];
    firstChannel: string | null;
    channels: Record<string, number>;
    density: JourneyDensity;
    inactivity: JourneyInactivity;
    dailyActivity: JourneyDailyActivity[];
}

export interface AttributionTouch {
    channel: string;
    at: string;
    gapText?: string; // 이전 터치와의 간격 ("3일 7시간")
}

export interface JourneyAttribution {
    firstTouch: AttributionTouch | null;
    lastTouch: AttributionTouch | null;
    conversionAt: string | null;
    path: AttributionTouch[];
}

export interface NextAction {
    label: string;
    reason: string;
    level: "urgent" | "important" | "info";
}

export interface JourneyData {
    summary: JourneySummary;
    events: JourneyEvent[];
    attribution: JourneyAttribution;
    nextActions: NextAction[];
}
