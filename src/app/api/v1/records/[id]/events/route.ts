import { NextRequest, NextResponse } from "next/server";
import { db, records } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
    getApiTokenFromNextRequest,
    resolveApiToken,
    checkTokenAccess,
} from "@/lib/auth";
import { parseEventInput, insertRecordEvent } from "@/lib/record-events";

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
    const parsed = parseEventInput(body);
    if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }

    const event = await insertRecordEvent({
        orgId: record.orgId,
        recordId,
        event: parsed.value,
    });

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
