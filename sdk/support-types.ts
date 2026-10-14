export interface SendbBusinessCalendar {
    timezone: string;
    weekly: { day: number; start: string; end: string }[];
    holidays: string[];
}
export interface SendbOperationsPolicy {
    enabled: boolean;
    calendar: SendbBusinessCalendar;
    showHours: boolean;
    awayMessage: string;
    includeAi: boolean;
    pauseOnSnooze: boolean;
    firstMinutes: number;
    nextMinutes: number;
    resolutionMinutes: number;
}
export interface SendbOperationsSettings {
    version: number;
    policy: SendbOperationsPolicy;
    configured: boolean;
    effectiveAt: string | null;
    workerEnabled: boolean;
    availability: { open: boolean; nextOpenAt: string | null } | null;
}
export interface SendbNotification {
    id: string;
    conversationId: string;
    channelId: number;
    type: string;
    preview: string;
    name: string;
    status: "open" | "snoozed" | "closed";
    createdAt: string;
    readAt: string | null;
}
export interface SendbNotificationPage {
    rows: SendbNotification[];
    hasMore: boolean;
    unread: number;
}
export interface SendbOperationsStats {
    started: number;
    closed: number;
    open: number;
    firstReplySamples: number;
    firstReplyMedianMs: number | null;
    resolutionSamples: number;
    resolutionMedianMs: number | null;
    closedUnanswered: number;
    resolutionTargets: number;
    resolutionMet: number;
    resolutionMissed: number;
    paused: number;
    aiFirst: number;
}
export interface SendbOperationsReport {
    period: {
        from: string;
        to: string;
        timezone: string;
        fromAt: string;
        toAt: string;
    };
    summary: SendbOperationsStats;
    response: {
        kind: string;
        total: number;
        targets: number;
        met: number;
        missed: number;
        awaiting: number;
        closedUnanswered: number;
        samples: number;
        medianMs: number | null;
    }[];
    daily: ({ day: string } & SendbOperationsStats)[];
    teammates: ({
        id: string | null;
        name: string | null;
    } & SendbOperationsStats)[];
    rows: {
        id: string;
        conversationId: string;
        channelId: number;
        name: string;
        medium: string;
        status: "open" | "snoozed" | "closed";
        startedAt: string;
        closedAt: string | null;
        firstReplyMs: number | null;
        firstResponder: string | null;
        resolutionMs: number | null;
        resolutionMissed: boolean;
        policyVersion: number;
        slaApplied: boolean;
    }[];
    hasMore: boolean;
    coverage: { untracked: number };
    workerEnabled: boolean;
}
export interface SendbConversationOperations {
    cases: {
        id: string;
        startedAt: string;
        closedAt: string | null;
        paused: boolean;
        policyVersion: number;
        slaApplied: boolean;
        firstReplyAt: string | null;
        firstReplyMs: number | null;
        firstResponder: string | null;
        resolutionDueAt: string | null;
        resolutionMs: number | null;
        resolutionMissed: boolean;
        waiting: {
            id: string;
            kind: string;
            startedAt: string;
            dueAt: string | null;
            missed: boolean;
        }[];
    }[];
    settingsEnabled: boolean;
    workerEnabled: boolean;
    historyOnly: boolean;
}
