import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors, records } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { identifyPayloadSchema } from "@/lib/tracker/validations";
import { matchesDomain } from "@/lib/tracker/domain-match";
import { rateLimit } from "@/lib/tracker/rate-limit";
import { linkVisitorRecord } from "@/lib/visitor-links";

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

    const { allowed } = rateLimit(`tracker-identify:${apiKey}`, {
        maxRequests: 50,
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

    const rawBody = await req.json().catch(() => null);
    const parsed = identifyPayloadSchema.safeParse(rawBody);
    if (!parsed.success) return cors(400, { error: "Invalid payload" }, origin);

    const { visitor_id, email, name, phone, user_id } = parsed.data;

    try {
        const visitor = await db.query.trackerVisitors.findFirst({
            where: and(
                eq(trackerVisitors.siteId, site.id),
                eq(trackerVisitors.visitorId, visitor_id),
            ),
        });
        if (!visitor) {
            return cors(404, { error: "Visitor not found" }, origin);
        }

        // record 매칭 우선순위:
        //  1) 커스텀 매칭 필드 (site.matchField) — user_id 값으로. 가장 신뢰.
        //  2) email
        //  3) phone (단, matchField 지정 site는 제외 — 번호 공유로 오연결 잦음)
        let recordId = visitor.recordId;
        // 신뢰 매칭(matchField/email)으로 잡힌 record는 링크에 누적, phone은 제외(오연결 방지)
        let trustMatchedRecordId: number | null = null;

        // 1) 커스텀 매칭 필드 — 이미 recordId가 있어도 항상 재시도하여 덮어쓴다.
        //    가입 직후 record가 늦게 생기거나, 초기에 fallback으로 잘못 박힌 경우를 교정.
        if (site.matchField && user_id) {
            const matched = (await db.execute(sql`
                SELECT id FROM records
                WHERE workspace_id = ${site.workspaceId}
                  AND data->>${site.matchField} = ${user_id}
                LIMIT 1
            `)) as unknown as Array<{ id: number }>;
            if (matched[0]) {
                recordId = matched[0].id;
                trustMatchedRecordId = matched[0].id;
            }
        }

        // 2) email fallback — recordId 없을 때만. (이메일은 거의 고유)
        if (!recordId && email) {
            const matched = (await db.execute(sql`
                SELECT id FROM records
                WHERE workspace_id = ${site.workspaceId}
                  AND data->>'email' = ${email}
                LIMIT 1
            `)) as unknown as Array<{ id: number }>;
            if (matched[0]) {
                recordId = matched[0].id;
                trustMatchedRecordId = matched[0].id;
            }
        }

        // 3) phone fallback — recordId 없고, matchField가 지정되지 않은 site만.
        //    전화번호는 가족/회사 공유로 충돌이 잦아 matchField 기반 site에선 신뢰하지 않는다.
        //    phone 매칭은 대표 record_id만 갱신하고 링크에는 누적하지 않는다.
        if (!recordId && !site.matchField && phone) {
            // 전화번호는 형식이 제각각이라 숫자만 비교
            const digits = phone.replace(/\D/g, "");
            if (digits.length >= 8) {
                const matched = (await db.execute(sql`
                    SELECT id FROM records
                    WHERE workspace_id = ${site.workspaceId}
                      AND regexp_replace(COALESCE(data->>'phone', ''), '\\D', '', 'g') = ${digits}
                    LIMIT 1
                `)) as unknown as Array<{ id: number }>;
                if (matched[0]) {
                    recordId = matched[0].id;
                }
            }
        }

        // 신뢰 매칭 record는 링크에 누적 (멱등) — visitor가 거쳐간 record 보존
        if (trustMatchedRecordId) {
            await linkVisitorRecord({
                orgId: site.orgId,
                visitorId: visitor.id,
                recordId: trustMatchedRecordId,
                source: "identify_match",
            });
        }

        await db
            .update(trackerVisitors)
            .set({
                recordId,
                // 식별자(user_id = site.matchField 값) 보존 — record가 늦게 생겨도 역매칭 가능하게
                matchValue: user_id ?? visitor.matchValue,
                email: email ?? visitor.email,
                name: name ?? visitor.name,
                phone: phone ?? visitor.phone,
                updatedAt: new Date(),
            })
            .where(eq(trackerVisitors.id, visitor.id));

        return cors(200, { ok: true, record_id: recordId }, origin);
    } catch (err) {
        console.error("Tracker identify error:", err);
        return cors(500, { error: "Internal error" }, origin);
    }
}
