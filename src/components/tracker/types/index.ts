export type TrackerSite = {
    id: number;
    orgId: string;
    workspaceId: number;
    name: string;
    apiKey: string;
    domains: string[];
    isActive: number;
    createdAt: string;
    updatedAt: string;
};

export type TrackerVisitor = {
    id: number;
    orgId: string;
    siteId: number;
    visitorId: string;
    recordId: number | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    firstSeenAt: string;
    lastSeenAt: string;
    totalVisits: number;
    totalPageviews: number;
    totalEvents: number;
    deviceType: string | null;
    browser: string | null;
    os: string | null;
    firstUtmSource: string | null;
    firstUtmMedium: string | null;
    firstUtmCampaign: string | null;
    lastUtmSource: string | null;
    lastUtmMedium: string | null;
    lastUtmCampaign: string | null;
    firstReferrer: string | null;
    lastReferrer: string | null;
    lastPage: string | null;
    lastEvent: string | null;
    lastEventAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type TrackerSession = {
    id: number;
    siteId: number;
    visitorId: number;
    sessionKey: string;
    startedAt: string;
    endedAt: string | null;
    duration: number | null;
    landingPage: string | null;
    exitPage: string | null;
    pageCount: number;
    trafficSource: string | null;
    referrer: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
    clickId: string | null;
    isFirstVisit: number;
};

export type TrackerEvent = {
    id: number;
    siteId: number;
    sessionId: number;
    visitorId: number;
    eventType: string;
    eventName: string | null;
    pageUrl: string | null;
    pageTitle: string | null;
    properties: Record<string, unknown> | null;
    revenue: string | null;
    occurredAt: string;
};

export type RecordVisitorActivity = {
    summary: {
        totalVisits: number;
        totalPageviews: number;
        totalEvents: number;
        deviceCount: number;
        firstSeen: string | null;
        lastSeen: string | null;
        devices: Array<{
            id: number;
            visitorId: string;
            type: string | null;
            browser: string | null;
            os: string | null;
            lastSeen: string;
            totalVisits: number;
        }>;
    } | null;
    recentEvents: TrackerEvent[];
    visitors: TrackerVisitor[];
};
