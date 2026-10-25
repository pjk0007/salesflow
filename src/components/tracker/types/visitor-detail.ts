import type { TrackerVisitor, TrackerSession, TrackerEvent } from "./index";

export type VisitorSummary = {
    totalDuration: number;
    totalVisits: number;
    totalPageviews: number;
    totalEvents: number;
    deviceCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    devices: Array<{
        id: number;
        visitorId: string;
        deviceType: string | null;
        browser: string | null;
        os: string | null;
        lastSeenAt: string;
    }>;
};

export type VisitorEngagement = {
    sections: Array<{ name: string; label: string | null; dwellMs: number; views: number }>;
    clicks: Array<{ name: string; label: string | null; count: number; text: string | null; href: string | null }>;
    pages: Array<{ url: string; title: string | null; views: number }>;
};

export type VisitorDailyActivity = { date: string; count: number };

export type VisitorHourlyActivity = { hour: number; count: number };

export type VisitorDetailResponse =
    | {
          success: true;
          data: {
              visitor: TrackerVisitor;
              summary: VisitorSummary;
              sessions: TrackerSession[];
              /** 세션마다 최신 이벤트(시간순). 세션 전체보다 적으면 sessionEventTotals로 알 수 있다 */
              events: TrackerEvent[];
              /** 세션 id → 세션의 전체 이벤트 수 */
              sessionEventTotals: Record<number, number>;
              engagement: VisitorEngagement;
              dailyActivity: VisitorDailyActivity[];
              hourlyActivity: VisitorHourlyActivity[];
              /** "SECTION_VIEW:name" | "CLICK:name" → 라벨 */
              aliases: Record<string, string>;
          };
      }
    | { success: false; error: string };

/** GET /api/tracker/visitors/{id}/events — 세션의 이전 행동 이어 받기 */
export type VisitorSessionEventsResponse =
    | { success: true; data: { events: TrackerEvent[]; hasMore: boolean } }
    | { success: false; error: string };
