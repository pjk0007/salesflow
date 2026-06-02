import { NextRequest, NextResponse } from "next/server";
import {
    db,
    trackerSites,
    trackerVisitors,
    trackerSessions,
    trackerEvents,
    emailClickLogs,
    emailSendLogs,
    records,
    visitorRecordLinks,
} from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { collectEventSchema, collectBatchSchema } from "@/lib/tracker/validations";
import { matchesDomain } from "@/lib/tracker/domain-match";
import { rateLimit } from "@/lib/tracker/rate-limit";

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

    // batch 페이로드(sendBeacon용) 우선 처리 — events 배열이 있으면 각각 INSERT.
    // SECTION_VIEW 외 PAGE_VIEW/세션 갱신성 이벤트는 batch에 들어오지 않도록 클라이언트가 보장한다고 가정.
    const batchParsed = collectBatchSchema.safeParse(rawBody);
    if (batchParsed.success) {
        const { visitor_id: vid, session_key: skey, events } = batchParsed.data;
        try {
            await db.transaction(async (tx) => {
                const visitor = await tx.query.trackerVisitors.findFirst({
                    where: and(eq(trackerVisitors.siteId, site.id), eq(trackerVisitors.visitorId, vid)),
                });
                const trackerSession = await tx.query.trackerSessions.findFirst({
                    where: and(eq(trackerSessions.siteId, site.id), eq(trackerSessions.sessionKey, skey)),
                });
                if (!visitor || !trackerSession) return; // 단건 호출이 먼저 visitor/session을 만들었어야 함

                const rows = events.map((ev) => ({
                    siteId: site.id,
                    sessionId: trackerSession.id,
                    visitorId: visitor.id,
                    eventType: ev.type,
                    eventName: ev.name ?? null,
                    pageUrl: ev.page_url ?? null,
                    pageTitle: ev.page_title ?? null,
                    properties: ev.properties ?? null,
                    revenue: ev.revenue != null ? String(ev.revenue) : null,
                }));
                if (rows.length > 0) await tx.insert(trackerEvents).values(rows);

                await tx
                    .update(trackerVisitors)
                    .set({
                        lastSeenAt: new Date(),
                        totalEvents: sql`${trackerVisitors.totalEvents} + ${rows.length}`,
                        updatedAt: new Date(),
                    })
                    .where(eq(trackerVisitors.id, visitor.id));
            });
            return cors(200, { ok: true, batched: events.length }, origin);
        } catch (err) {
            console.error("Tracker batch collect error:", err);
            return cors(500, { error: "Internal error" }, origin);
        }
    }

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

            // 이번 요청이 visitor row를 실제로 새로 만들었는지.
            // totalVisits default가 1이므로, 신규 생성한 visitor의 첫 세션에서는 +1을 하지 않아야
            // "첫 방문 = 1"이 된다 (기존 visitor의 새 세션일 때만 +1).
            let visitorCreated = false;

            if (!visitor) {
                // 동시 요청(신규 방문자가 이벤트를 동시 발사)이면 둘 다 INSERT를 시도해
                // unique(site_id, visitor_id) 충돌이 난다. onConflictDoNothing으로 흡수하고,
                // INSERT가 스킵되면(빈 배열) 다른 요청이 만든 row를 재조회한다.
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
                    .onConflictDoNothing({
                        target: [trackerVisitors.siteId, trackerVisitors.visitorId],
                    })
                    .returning();
                if (created) {
                    visitor = created;
                    visitorCreated = true;
                } else {
                    // 충돌로 스킵됨 — 다른 동시 요청이 만든 row 재조회
                    visitor = await tx.query.trackerVisitors.findFirst({
                        where: and(
                            eq(trackerVisitors.siteId, site.id),
                            eq(trackerVisitors.visitorId, visitor_id),
                        ),
                    });
                    if (!visitor) throw new Error("visitor upsert failed");
                }
            }

            // 2. click_id로 record 자동 매칭 (click_id 있으면 항상 시도 — 링크 누적)
            if (click_id) {
                const [match] = await tx
                    .select({
                        recordId: emailSendLogs.recordId,
                        recipientEmail: emailSendLogs.recipientEmail,
                        recordWorkspaceId: records.workspaceId,
                    })
                    .from(emailClickLogs)
                    .innerJoin(emailSendLogs, eq(emailClickLogs.sendLogId, emailSendLogs.id))
                    .innerJoin(records, eq(emailSendLogs.recordId, records.id))
                    .where(eq(emailClickLogs.clickId, click_id))
                    .limit(1);

                // 같은 워크스페이스의 메일 클릭일 때만 연결.
                // 다른 워크스페이스 메일의 click_id가 (localStorage 등으로)
                // 흘러들어와도 엉뚱한 record에 엮이지 않도록 격리.
                if (match?.recordId && match.recordWorkspaceId === site.workspaceId) {
                    // 링크 누적 (신뢰 키 click_id) — 멱등
                    await tx
                        .insert(visitorRecordLinks)
                        .values({
                            orgId: site.orgId,
                            visitorId: visitor.id,
                            recordId: match.recordId,
                            source: "click_id",
                        })
                        .onConflictDoNothing({
                            target: [visitorRecordLinks.visitorId, visitorRecordLinks.recordId],
                        });

                    // 대표 record_id는 비어 있을 때만 set (덮어쓰기 X)
                    if (!visitor.recordId) {
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
            }

            // 3. session UPSERT
            let trackerSession = await tx.query.trackerSessions.findFirst({
                where: and(
                    eq(trackerSessions.siteId, site.id),
                    eq(trackerSessions.sessionKey, session_key),
                ),
            });

            if (!trackerSession) {
                // 첫 세션 여부 = visitor를 이번 요청에서 새로 만들었는가.
                // 신규 visitor의 첫 세션이 곧 첫 방문 — count 쿼리는 동시성에 약해(둘 다 0 판정)
                // visitorCreated 플래그로 판정한다.
                const isFirstVisit = visitorCreated;

                // visitor와 동일한 동시성 문제 — onConflictDoNothing으로 흡수 후 재조회.
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
                        isFirstVisit: isFirstVisit ? 1 : 0,
                    })
                    .onConflictDoNothing({
                        target: [trackerSessions.siteId, trackerSessions.sessionKey],
                    })
                    .returning();

                if (created) {
                    trackerSession = created;
                    // 새 세션을 실제로 만든 요청만 totalVisits +1.
                    // 단 신규 visitor는 default totalVisits=1로 이미 첫 방문이 반영돼 있으므로,
                    // 그 첫 세션에서는 +1을 하지 않는다 (기존 visitor의 새 세션일 때만 +1).
                    if (!visitorCreated) {
                        await tx
                            .update(trackerVisitors)
                            .set({
                                totalVisits: sql`${trackerVisitors.totalVisits} + 1`,
                                lastSeenAt: new Date(),
                                updatedAt: new Date(),
                            })
                            .where(eq(trackerVisitors.id, visitor.id));
                    }
                } else {
                    // 동시 요청이 먼저 만든 세션을 재조회
                    trackerSession = await tx.query.trackerSessions.findFirst({
                        where: and(
                            eq(trackerSessions.siteId, site.id),
                            eq(trackerSessions.sessionKey, session_key),
                        ),
                    });
                    if (!trackerSession) throw new Error("session upsert failed");
                }
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

            return { visitor: refreshed, sessionId: trackerSession.id };
        });

        return cors(
            200,
            {
                ok: true,
                visitor_id: result.visitor.id,
                record_id: result.visitor.recordId,
                // 크로스도메인 링킹용 — 등록된 도메인 목록
                domains: site.domains,
            },
            origin,
        );
    } catch (err) {
        console.error("Tracker collect error:", err);
        return cors(500, { error: "Internal error" }, origin);
    }
}
