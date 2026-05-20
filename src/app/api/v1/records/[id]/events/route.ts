import { NextRequest, NextResponse } from "next/server";
import { db, records, recordEvents } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
    getApiTokenFromNextRequest,
    resolveApiToken,
    checkTokenAccess,
} from "@/lib/auth";

// 외부 고객사(디하 server 등)가 record에 비즈니스 이벤트(단계 변경 등)를
// append-only로 기록할 때 호출. record_events 테이블에 한 줄 INSERT.

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
};

async function handlePost(req: NextRequest, recordId: number) {
    const tokenStr = getApiTokenFromNextRequest(req);
    const tokenInfo = tokenStr ? await resolveApiToken(tokenStr) : null;
    if (!tokenInfo) {
        return NextResponse.json(
            { success: false, error: "Invalid or missing API token." },
            { status: 401 }
        );
    }

    const [record] = await db
        .select()
        .from(records)
        .where(eq(records.id, recordId));
    // 다른 org의 record는 존재 여부조차 노출하지 않음
    if (!record || record.orgId !== tokenInfo.orgId) {
        return NextResponse.json(
            { success: false, error: "Record not found." },
            { status: 404 }
        );
    }

    const hasAccess = await checkTokenAccess(tokenInfo, record.partitionId, "create");
    if (!hasAccess) {
        return NextResponse.json(
            { success: false, error: "Access denied for this record." },
            { status: 403 }
        );
    }

    const body = await req.json();
    const type = typeof body.type === "string" ? body.type.trim() : "";
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!type || type.length > 50) {
        return NextResponse.json(
            { success: false, error: "type is required (max 50 chars)." },
            { status: 400 }
        );
    }
    if (!label || label.length > 100) {
        return NextResponse.json(
            { success: false, error: "label is required (max 100 chars)." },
            { status: 400 }
        );
    }

    let occurredAt = new Date();
    if (body.occurredAt !== undefined && body.occurredAt !== null) {
        const parsed = new Date(body.occurredAt);
        if (isNaN(parsed.getTime())) {
            return NextResponse.json(
                { success: false, error: "occurredAt is invalid." },
                { status: 400 }
            );
        }
        occurredAt = parsed;
    }

    let meta: Record<string, unknown> | null = null;
    if (body.meta !== undefined && body.meta !== null) {
        if (typeof body.meta !== "object" || Array.isArray(body.meta)) {
            return NextResponse.json(
                { success: false, error: "meta must be an object." },
                { status: 400 }
            );
        }
        meta = body.meta as Record<string, unknown>;
    }

    const [event] = await db
        .insert(recordEvents)
        .values({
            orgId: record.orgId,
            recordId,
            type,
            label,
            occurredAt,
            meta,
        })
        .returning();

    return NextResponse.json({ success: true, data: event }, { status: 201 });
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const recordId = Number(id);
    let res: NextResponse;
    if (!recordId) {
        res = NextResponse.json(
            { success: false, error: "Invalid record id." },
            { status: 400 }
        );
    } else {
        try {
            res = await handlePost(req, recordId);
        } catch (error) {
            console.error("Record event create error:", error);
            res = NextResponse.json(
                { success: false, error: "Internal server error." },
                { status: 500 }
            );
        }
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
        res.headers.set(k, v);
    }
    return res;
}
