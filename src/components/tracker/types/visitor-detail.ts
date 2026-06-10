import type { TrackerVisitor, TrackerSession, TrackerEvent } from "./index";

export type VisitorSummary = {
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
              events: TrackerEvent[];
              engagement: VisitorEngagement;
              dailyActivity: VisitorDailyActivity[];
              hourlyActivity: VisitorHourlyActivity[];
              /** "SECTION_VIEW:name" | "CLICK:name" → 라벨 */
              aliases: Record<string, string>;
          };
      }
    | { success: false; error: string };
