import { NextRequest, NextResponse } from "next/server";
import { db, trackerSites, trackerVisitors, records } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import { identifyPayloadSchema } from "@/lib/tracker/validations";
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

    const { visitor_id, email, name, phone } = parsed.data;

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

        // 같은 워크스페이스 안에서 record 매칭 — 이메일 우선, 없으면 전화번호
        let recordId = visitor.recordId;
        if (!recordId && email) {
            const matched = (await db.execute(sql`
                SELECT id FROM records
                WHERE workspace_id = ${site.workspaceId}
                  AND data->>'email' = ${email}
                LIMIT 1
            `)) as unknown as Array<{ id: number }>;
            if (matched[0]) {
                recordId = matched[0].id;
            }
        }
        if (!recordId && phone) {
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

        await db
            .update(trackerVisitors)
            .set({
                recordId,
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
