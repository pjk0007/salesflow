import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, users } from "@/lib/db";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import type { TabPrefs } from "@/lib/db/schema";

const TAB_KEY = /^[a-z0-9-]{1,40}$/;
const FIELDS = ["order", "hidden", "added"] as const;

const isIdList = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 500 && v.every((n) => Number.isInteger(n) && n > 0);

// GET: 내 화면 설정 (사업부 탭 순서·숨김 등)
export async function GET(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    try {
        const [row] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, user.userId));
        return NextResponse.json({ success: true, data: row?.preferences ?? {} });
    } catch (error) {
        console.error("Preferences fetch error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}

// PUT: 사업부 탭 설정 저장 {tabKey, order?, hidden?, added?} — 보낸 항목만 바꾸고 다른 설정은 그대로 둔다
export async function PUT(req: NextRequest) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    const body = await req.json().catch(() => null);
    const tabKey = body?.tabKey;
    if (typeof tabKey !== "string" || !TAB_KEY.test(tabKey)) {
        return NextResponse.json({ success: false, error: "잘못된 화면입니다." }, { status: 400 });
    }
    const patch: TabPrefs = {};
    for (const field of FIELDS) {
        if (body[field] === undefined) continue;
        if (!isIdList(body[field])) return NextResponse.json({ success: false, error: "탭 설정을 확인해 주세요." }, { status: 400 });
        patch[field] = [...new Set(body[field] as number[])];
    }
    if (Object.keys(patch).length === 0) {
        return NextResponse.json({ success: false, error: "바꿀 설정이 없습니다." }, { status: 400 });
    }
    try {
        const value = JSON.stringify(patch);
        await db
            .update(users)
            .set({
                preferences: sql`${users.preferences} || jsonb_build_object('tabs', coalesce(${users.preferences}->'tabs', '{}'::jsonb) || jsonb_build_object(${tabKey}::text, coalesce(${users.preferences}->'tabs'->${tabKey}::text, '{}'::jsonb) || ${value}::jsonb))`,
            })
            .where(eq(users.id, user.userId));
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Preferences save error:", error);
        return NextResponse.json({ success: false, error: "서버 오류가 발생했습니다." }, { status: 500 });
    }
}
