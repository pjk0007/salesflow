import { NextRequest, NextResponse } from "next/server";
import { getActiveUserFromNextRequest } from "@/lib/auth";
import { requireRecordAccess } from "@/lib/partition-access";
import { SalesAiError } from "./ai";

type User = NonNullable<Awaited<ReturnType<typeof getActiveUserFromNextRequest>>>;

export const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
export const ok = (data: unknown, status = 200) => NextResponse.json({ success: true, data }, { status });

/** 로그인 확인 + (recordId가 있으면) 레코드 권한 확인 후 실행, 오류는 한국어 메시지로 */
export async function salesHandler(
    req: NextRequest,
    run: (user: User) => Promise<NextResponse>,
): Promise<NextResponse> {
    const user = await getActiveUserFromNextRequest(req);
    if (!user) return fail("인증이 필요합니다.", 401);
    try {
        return await run(user);
    } catch (e) {
        if (e instanceof SalesAiError) return fail(e.message, e.status);
        console.error("Sales API error:", e);
        return fail("서버 오류가 발생했습니다.", 500);
    }
}

export async function recordGuard(user: User, recordId: number, permission: "read" | "update") {
    if (!recordId) return { error: fail("레코드 ID가 필요합니다.") };
    const access = await requireRecordAccess(user, recordId, permission);
    if (!access.ok) return { error: fail(access.error, access.status) };
    return { access };
}
