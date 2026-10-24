import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getActiveUserFromNextRequest } from "../auth";
import { queryClient } from "../db";
import type { CopyConnection } from "./types";
import { CopyDeferredError } from "./generation";
import { CopyActionError } from "./errors";

export { CopyActionError } from "./errors";
export async function copyAdminApi(
    req: NextRequest,
    action: (
        conn: CopyConnection,
        user: NonNullable<Awaited<ReturnType<typeof getActiveUserFromNextRequest>>>,
    ) => Promise<unknown>,
) {
    const user = await getActiveUserFromNextRequest(req);
    if (!user)
        return NextResponse.json({ success: false, error: "인증이 필요합니다." }, { status: 401 });
    if (user.role === "member")
        return NextResponse.json(
            { success: false, error: "이 기능은 관리자 권한이 필요합니다." },
            { status: 403 },
        );
    const conn = await queryClient.reserve();
    try {
        return NextResponse.json({ success: true, data: await action(conn, user) });
    } catch (error) {
        if (error instanceof ZodError)
            return NextResponse.json(
                { success: false, error: error.issues[0]?.message ?? "입력 항목을 확인해 주세요." },
                { status: 400 },
            );
        if (error instanceof CopyActionError)
            return NextResponse.json({ success: false, error: error.message }, { status: 400 });
        if (error instanceof CopyDeferredError)
            return NextResponse.json(
                {
                    success: false,
                    error: error.reason,
                    retryAt: error.retryAt.toISOString(),
                    held: error.held,
                },
                { status: 409 },
            );
        console.error("[ai-copy] 요청 처리 실패", {
            code: (error as { code?: unknown })?.code ?? "internal",
        });
        return NextResponse.json(
            { success: false, error: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
            { status: 500 },
        );
    } finally {
        conn.release();
    }
}
