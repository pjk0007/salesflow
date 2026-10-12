import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, workspaces } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-admin";
import { previewDeepVisitorAlerts, describeDeepAlertError } from "@/lib/deep-visitor-alert";
import {
    prefersHtml,
    renderDeepAlertPreviewErrorHtml,
    renderDeepAlertPreviewHtml,
} from "@/lib/deep-visitor-alert-rules";

/**
 * GET /api/tracker/deep-alerts/preview?workspaceId=8&now=2026-10-01T15:00:00%2B09:00
 *
 * 지금(또는 now 시점) 판정하면 나갈 카드 목록. **읽기만** 한다 — 표에 쓰지 않고 챗으로 보내지 않는다.
 * 개발 DB는 덤프라 새 방문이 없어서 now로 과거 시점을 넣어 시험한다.
 *
 * 같은 주소가 두 모양으로 답한다 (Accept로 고른다, 내용은 같다):
 * - 브라우저 주소창(Accept가 JSON보다 text/html을 원함) → 카드를 챗처럼 읽을 수 있는 HTML 한 장
 * - 그 밖(fetch·API 클라이언트) → 지금까지와 같은 JSON `{ success, data }`
 */

/** 같은 주소가 Accept에 따라 다른 모양을 주므로 캐시가 섞지 않게 한다. 고객 정보라 저장하지 않는다 */
const COMMON_HEADERS = { Vary: "Accept" };
const HTML_HEADERS = {
    ...COMMON_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // 사용자 값은 모두 이스케이프하지만, 혹시 새어도 스크립트·외부 자원이 돌지 않게 막는다
    "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export async function GET(req: NextRequest) {
    const asHtml = prefersHtml(req.headers.get("accept"));
    const fail = (error: string, status: number) =>
        asHtml
            ? new NextResponse(renderDeepAlertPreviewErrorHtml(error), { status, headers: HTML_HEADERS })
            : NextResponse.json({ success: false, error }, { status, headers: COMMON_HEADERS });

    const auth = await requireAdmin(req);
    if (!auth.ok) return fail(auth.error, auth.status);
    const user = auth.user;

    const sp = req.nextUrl.searchParams;
    const workspaceId = Number(sp.get("workspaceId"));
    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
        return fail("workspaceId가 필요합니다.", 400);
    }

    const nowParam = sp.get("now");
    let now: Date | undefined;
    if (nowParam) {
        now = new Date(nowParam);
        if (Number.isNaN(now.getTime())) {
            return fail("now가 올바른 날짜 형식이 아닙니다.", 400);
        }
    }

    // 다른 조직의 고객 정보를 미리보기로 열지 못하게 워크스페이스 소유를 먼저 확인한다
    const [workspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.orgId, user.orgId)));
    if (!workspace) {
        return fail("워크스페이스를 찾을 수 없습니다.", 404);
    }

    try {
        const judgedAt = now ?? new Date();
        const data = await previewDeepVisitorAlerts({ orgId: user.orgId, workspaceId, now });
        // 미리보기는 큰 표를 훑으므로 한 번에 하나만 돈다
        if (data.busy) {
            return fail("다른 미리보기가 도는 중입니다. 잠시 뒤 다시 시도하세요.", 409);
        }
        if (asHtml) {
            const html = renderDeepAlertPreviewHtml(data, { workspaceId, now: judgedAt, nowGiven: now !== undefined });
            return new NextResponse(html, { status: 200, headers: HTML_HEADERS });
        }
        return NextResponse.json({ success: true, data }, { headers: COMMON_HEADERS });
    } catch (error) {
        console.error("[deep-alert] preview error:", describeDeepAlertError(error));
        return fail("미리보기를 만들지 못했습니다.", 500);
    }
}
