import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { openOAuthState } from "@/lib/auth";
import type { MetaCredentials } from "@/types";
import { exchangeLongLivedToken } from "@/lib/meta-graph";

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    const stateParam = req.nextUrl.searchParams.get("state");
    const errorParam = req.nextUrl.searchParams.get("error");

    if (errorParam) {
        return htmlResponse("error", "Meta 연결이 취소되었습니다.");
    }

    if (!code || !stateParam) {
        return htmlResponse("error", "잘못된 요청입니다.");
    }

    // 봉인된 state에서 orgId, platformId 복원 — 위조·만료된 state는 거부한다
    const state = openOAuthState<{ orgId: string; platformId: number }>("meta", stateParam);
    if (!state || typeof state.orgId !== "string" || !Number.isSafeInteger(state.platformId)) {
        return htmlResponse("error", "연결 요청이 만료되었거나 올바르지 않습니다. 연동 화면에서 다시 시도해주세요.");
    }
    const platformId = state.platformId;

    // DB에서 플랫폼의 appId/appSecret 조회 — state를 만든 조직의 플랫폼만
    const [platform] = await db
        .select()
        .from(adPlatforms)
        .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.orgId, state.orgId)))
        .limit(1);

    if (!platform) {
        return htmlResponse("error", "플랫폼을 찾을 수 없습니다.");
    }

    const credentials = platform.credentials as MetaCredentials;
    const { appId, appSecret } = credentials;

    if (!appId || !appSecret) {
        return htmlResponse("error", "Meta App ID/Secret이 누락되었습니다.");
    }

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/meta/callback`;

    try {
        // 1. code → access_token 교환
        const tokenRes = await fetch(
            `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
        );
        const tokenData = await tokenRes.json();

        if (!tokenRes.ok || tokenData.error || typeof tokenData.access_token !== "string" || !tokenData.access_token.trim()) {
            return htmlResponse("error", "Meta 인증에 실패했습니다. 권한을 확인하고 다시 연결해주세요.");
        }

        // 2. 단기 토큰(약 1~2시간)을 장기 토큰으로 바꿔 저장한다 — 리드 웹훅이 이 토큰으로 리드를 읽는다 (UX-049)
        const token = await exchangeLongLivedToken({
            appId,
            appSecret,
            shortToken: tokenData.access_token,
            shortExpiresIn: tokenData.expires_in,
        });

        // 3. 기존 플랫폼 레코드 업데이트 (accessToken·만료 시각 + 상태)
        await db
            .update(adPlatforms)
            .set({
                credentials: {
                    ...credentials,
                    accessToken: token.accessToken,
                    tokenExpiresAt: token.expiresAt,
                },
                status: "connected",
                updatedAt: new Date(),
            })
            .where(eq(adPlatforms.id, platformId));

        return htmlResponse(
            "success",
            token.longLived
                ? "Meta 연결이 완료되었습니다!"
                : "Meta 연결은 완료됐지만 장기 토큰을 받지 못했습니다. 연결이 곧 만료될 수 있으니 만료 시각을 확인하고 다시 연결해주세요."
        );
    } catch (err) {
        console.error("Meta callback error:", err);
        return htmlResponse("error", "연결 처리 중 오류가 발생했습니다.");
    }
}

function htmlResponse(status: "success" | "error", message: string) {
    const payload = JSON.stringify({ type: "meta-oauth-callback", status, message }).replace(/</g, "\\u003c");
    const safeMessage = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return new Response(
        `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>Meta 연결</title></head>
<body>
<script>
    const payload = ${payload};
    if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
        window.close();
    } else {
        document.body.innerText = payload.message;
        setTimeout(() => window.close(), 2000);
    }
</script>
<p>${safeMessage}</p>
</body>
</html>`,
        // charset이 없으면 브라우저가 한국어 안내를 다른 인코딩으로 읽어 글자가 깨진다 (UX-049)
        { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
    );
}
