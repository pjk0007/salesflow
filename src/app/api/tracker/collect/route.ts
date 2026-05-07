import { NextRequest, NextResponse } from "next/server";
import {
    db,
    trackerSites,
    trackerVisitors,
    trackerSessions,
    trackerEvents,
    emailClickLogs,
    emailSendLogs,
} from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { collectEventSchema } from "@/lib/tracker/validations";
import { matchesDomain } from "@/lib/tracker/domain-match";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { mirrorVisitorToRecord } from "@/lib/tracker/mirror-record";

function corsHeaders(origin: string) {
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
        "Access-Control-Max-Age": "86400",
    };
}

function cors(status: number, body: unknown, origin: string) {
    return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(req: NextRequest) {
    const origin = req.headers.get("origin") || "*";
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
    const origin = req.headers.get("origin") || "";
    const apiKey =
        req.headers.get("x-api-key") ||
        req.nextUrl.searchParams.get("key") ||
        "";

    if (!apiKey) return cors(401, { error: "API key required" }, origin);

    const { allowed } = rateLimit(`tracker:${apiKey}`, {
        maxRequests: 200,
        windowMs: 60_000,
    });
    if (!allowed) return cors(429, { error: "Too many requests" }, origin);

    const site = await db.query.trackerSites.findFirst({
        where: and(eq(trackerSites.apiKey, apiKey), eq(trackerSites.isActive, 1)),
    });
    if (!site) return cors(401, { error: "Invalid API key" }, origin);

    if (origin && !matchesDomain(origin, site.domains)) {
        return cors(403, { error: "Origin not allowed" }, origin);
    }

    const cl = req.headers.get("content-length");
    if (cl && parseInt(cl, 10) > 10240) {
        return cors(413, { error: "Payload too large" }, origin);
    }

    const rawBody = await req.json().catch(() => null);
    const parsed = collectEventSchema.safeParse(rawBody);
    if (!parsed.success) return cors(400, { error: "Invalid payload" }, origin);

    const { visitor_id, session_key, click_id, event, session, device } = parsed.data;

    try {
        const result = await db.transaction(async (tx) => {
            // 1. visitor UPSERT
            let visitor = await tx.query.trackerVisitors.findFirst({
                where: and(
                    eq(trackerVisitors.siteId, site.id),
                    eq(trackerVisitors.visitorId, visitor_id),
                ),
            });

            if (!visitor) {
                const [created] = await tx
                    .insert(trackerVisitors)
                    .values({
                        orgId: site.orgId,
                        siteId: site.id,
                        visitorId: visitor_id,
                        deviceType: device?.type ?? null,
                        browser: device?.browser ?? null,
                        os: device?.os ?? null,
                        firstUtmSource: session?.utm_source ?? null,
                        firstUtmMedium: session?.utm_medium ?? null,
                        firstUtmCampaign: session?.utm_campaign ?? null,
                        lastUtmSource: session?.utm_source ?? null,
                        lastUtmMedium: session?.utm_medium ?? null,
                        lastUtmCampaign: session?.utm_campaign ?? null,
                        firstReferrer: session?.referrer ?? null,
                        lastReferrer: session?.referrer ?? null,
                    })
                    .returning();
                visitor = created;
            }

            // 2. click_id로 record 자동 매칭 (visitor에 recordId가 비어 있을 때만)
            if (click_id && !visitor.recordId) {
                const [match] = await tx
                    .select({
                        recordId: emailSendLogs.recordId,
                        recipientEmail: emailSendLogs.recipientEmail,
                    })
                    .from(emailClickLogs)
                    .innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
                    .where(eq(emailClickLogs.clickId, click_id))
                    .limit(1);

                if (match?.recordId) {
                    await tx
                        .update(trackerVisitors)
                        .set({
                            recordId: match.recordId,
                            email: visitor.email ?? match.recipientEmail,
                            updatedAt: new Date(),
                        })
                        .where(eq(trackerVisitors.id, visitor.id));
                    visitor.recordId = match.recordId;
                    visitor.email = visitor.email ?? match.recipientEmail;
                }
            }

            // 3. session UPSERT
            let trackerSession = await tx.query.trackerSessions.findFirst({
                where: and(
                    eq(trackerSessions.siteId, site.id),
                    eq(trackerSessions.sessionKey, session_key),
                ),
            });

            if (!trackerSession) {
                // 첫 세션인지 판정
                const [{ count }] = await tx
                    .select({ count: sql<number>`COUNT(*)::integer` })
                    .from(trackerSessions)
                    .where(
                        and(
                            eq(trackerSessions.siteId, site.id),
                            eq(trackerSessions.visitorId, visitor.id),
                        ),
                    );

                const [created] = await tx
                    .insert(trackerSessions)
                    .values({
                        siteId: site.id,
                        visitorId: visitor.id,
                        sessionKey: session_key,
                        landingPage: session?.landing_page ?? event.page_url ?? null,
                        // 첫 PAGE_VIEW도 카운트
                        pageCount: event.type === "PAGE_VIEW" ? 1 : 0,
                        exitPage: event.type === "PAGE_VIEW" ? event.page_url ?? null : null,
                        trafficSource: session?.traffic_source ?? null,
                        referrer: session?.referrer ?? null,
                        utmSource: session?.utm_source ?? null,
                        utmMedium: session?.utm_medium ?? null,
                        utmCampaign: session?.utm_campaign ?? null,
                        utmTerm: session?.utm_term ?? null,
                        utmContent: session?.utm_content ?? null,
                        clickId: click_id ?? null,
                        isFirstVisit: count === 0 ? 1 : 0,
                    })
                    .returning();
                trackerSession = created;

                // 새 세션이면 visitor.totalVisits +1
                await tx
                    .update(trackerVisitors)
                    .set({
                        totalVisits: sql`${trackerVisitors.totalVisits} + 1`,
                        lastSeenAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(trackerVisitors.id, visitor.id));
            } else if (event.type === "PAGE_VIEW") {
                await tx.execute(sql`
                    UPDATE tracker_sessions
                    SET ended_at = NOW(),
                        duration = EXTRACT(EPOCH FROM (NOW() - started_at))::integer,
                        page_count = page_count + 1,
                        exit_page = ${event.page_url ?? null}
                    WHERE id = ${trackerSession.id}
                `);
            } else if (event.type === "HEARTBEAT" || event.type === "SESSION_END") {
                await tx.execute(sql`
                    UPDATE tracker_sessions
                    SET ended_at = NOW(),
                        duration = EXTRACT(EPOCH FROM (NOW() - started_at))::integer
                    WHERE id = ${trackerSession.id}
                `);
            }

            // 4. HEARTBEAT/SESSION_END는 event 저장 X
            if (event.type === "HEARTBEAT" || event.type === "SESSION_END") {
                return { visitor, sessionId: trackerSession.id };
            }

            // 5. event INSERT
            await tx.insert(trackerEvents).values({
                siteId: site.id,
                sessionId: trackerSession.id,
                visitorId: visitor.id,
                eventType: event.type,
                eventName: event.name ?? null,
                pageUrl: event.page_url ?? null,
                pageTitle: event.page_title ?? null,
                properties: event.properties ?? null,
                revenue: event.revenue != null ? String(event.revenue) : null,
            });

            // 6. visitor 마지막 활동 + 카운터
            const updates: Record<string, unknown> = {
                lastSeenAt: new Date(),
                lastEvent: event.type === "CUSTOM" ? event.name ?? "CUSTOM" : event.type,
                lastEventAt: new Date(),
                totalEvents: sql`${trackerVisitors.totalEvents} + 1`,
                updatedAt: new Date(),
            };
            if (event.page_url) updates.lastPage = event.page_url;
            if (event.type === "PAGE_VIEW") {
                updates.totalPageviews = sql`${trackerVisitors.totalPageviews} + 1`;
            }
            if (session?.utm_source) {
                updates.lastUtmSource = session.utm_source;
                updates.lastUtmMedium = session.utm_medium ?? null;
                updates.lastUtmCampaign = session.utm_campaign ?? null;
                updates.lastReferrer = session.referrer ?? null;
            }

            const [refreshed] = await tx
                .update(trackerVisitors)
                .set(updates)
                .where(eq(trackerVisitors.id, visitor.id))
                .returning();

            // records mirror도 같은 트랜잭션에서 처리 (트래커 파티션이 설정된 경우)
            if (site.partitionId) {
                await mirrorVisitorToRecord(tx, {
                    orgId: site.orgId,
                    workspaceId: site.workspaceId,
                    partitionId: site.partitionId,
                    visitor: refreshed,
                });
            }

            return { visitor: refreshed, sessionId: trackerSession.id };
        });

        return cors(
            200,
            {
                ok: true,
                visitor_id: result.visitor.id,
                record_id: result.visitor.recordId,
            },
            origin,
        );
    } catch (err) {
        console.error("Tracker collect error:", err);
        return cors(500, { error: "Internal error" }, origin);
    }
}
