import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { MetaCredentials } from "@/types";

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

    // state에서 orgId, userId, platformId 복원
    let platformId: number;
    try {
        const state = JSON.parse(Buffer.from(stateParam, "base64").toString());
        platformId = state.platformId;
    } catch {
        return htmlResponse("error", "잘못된 state 파라미터입니다.");
    }

    // DB에서 플랫폼의 appId/appSecret 조회
    const [platform] = await db
        .select()
        .from(adPlatforms)
        .where(eq(adPlatforms.id, platformId))
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

        if (tokenData.error) {
            return htmlResponse("error", `토큰 교환 실패: ${tokenData.error.message}`);
        }

        const accessToken = tokenData.access_token;

        // 2. 기존 플랫폼 레코드 업데이트 (accessToken 채우기 + 상태)
        await db
            .update(adPlatforms)
            .set({
                credentials: {
                    ...credentials,
                    accessToken,
                },
                status: "connected",
                updatedAt: new Date(),
            })
            .where(eq(adPlatforms.id, platformId));

        return htmlResponse("success", "Meta 연결이 완료되었습니다!");
    } catch (err) {
        console.error("Meta callback error:", err);
        return htmlResponse("error", "연결 처리 중 오류가 발생했습니다.");
    }
}

function htmlResponse(status: "success" | "error", message: string) {
    return new Response(
        `<!DOCTYPE html>
<html>
<head><title>Meta 연결</title></head>
<body>
<script>
    if (window.opener) {
        window.opener.postMessage({ type: "meta-oauth-callback", status: "${status}", message: "${message}" }, "*");
        window.close();
    } else {
        document.body.innerText = "${message}";
        setTimeout(() => window.close(), 2000);
    }
</script>
<p>${message}</p>
</body>
</html>`,
        { headers: { "Content-Type": "text/html" } }
    );
}
