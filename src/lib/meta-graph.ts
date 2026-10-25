import { db } from "@/lib/db";
import { adPlatforms } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Meta Graph API 공통 처리 — 오류 해석·장기 토큰 교환·토큰 만료 표시 (UX-049·051).
 * 실제 호출은 각 경로가 하고, 여기서는 응답 해석과 상태 갱신만 한다.
 */

const GRAPH_URL = "https://graph.facebook.com/v21.0";

export interface MetaGraphError {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
}

/** 토큰 만료·취소·무효 — 다시 인증해야 풀린다 (OAuthException 190, 세션 102) */
export function isMetaTokenError(error: MetaGraphError | null | undefined): boolean {
    if (!error) return false;
    return error.code === 190 || error.code === 102;
}

/** Meta 영문 오류를 화면에 보일 한국어 안내로 바꾼다. 원문은 서버 로그·rawData에만 남긴다 */
export function metaErrorMessage(error: MetaGraphError | null | undefined): string {
    if (isMetaTokenError(error)) {
        return "Meta 인증이 만료되었거나 취소되었습니다. '다시 연결'로 Meta 계정을 다시 인증해주세요.";
    }
    const code = error?.code;
    if (code === 4 || code === 17 || code === 32 || code === 613) {
        return "Meta 요청 한도를 넘었습니다. 잠시 뒤 다시 시도해주세요.";
    }
    if (code === 10 || (typeof code === "number" && code >= 200 && code < 300)) {
        return "Meta 권한이 부족합니다. 다시 연결할 때 요청한 권한을 모두 허용했는지 확인해주세요.";
    }
    return "Meta 요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해주세요.";
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export interface MetaTokenResult {
    accessToken: string;
    /** 만료 시각(ISO). Meta가 expires_in을 주지 않으면 null */
    expiresAt: string | null;
    longLived: boolean;
}

function expiresAtFrom(expiresIn: unknown, now: Date): string | null {
    return typeof expiresIn === "number" && expiresIn > 0
        ? new Date(now.getTime() + expiresIn * 1000).toISOString()
        : null;
}

/**
 * 코드 교환으로 받은 단기 사용자 토큰을 장기 토큰(fb_exchange_token)으로 바꾼다.
 * 교환이 실패하면 단기 토큰과 그 만료 시각을 그대로 돌려준다 — 연결 자체는 막지 않고 만료 시각을 화면에 보인다.
 */
export async function exchangeLongLivedToken(
    input: { appId: string; appSecret: string; shortToken: string; shortExpiresIn?: unknown },
    fetchImpl: FetchLike = fetch,
    now: Date = new Date()
): Promise<MetaTokenResult> {
    const fallback: MetaTokenResult = {
        accessToken: input.shortToken,
        expiresAt: expiresAtFrom(input.shortExpiresIn, now),
        longLived: false,
    };
    try {
        const params = new URLSearchParams({
            grant_type: "fb_exchange_token",
            client_id: input.appId,
            client_secret: input.appSecret,
            fb_exchange_token: input.shortToken,
        });
        const res = await fetchImpl(`${GRAPH_URL}/oauth/access_token?${params.toString()}`);
        const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown; error?: MetaGraphError };
        if (!res.ok || data.error || typeof data.access_token !== "string" || !data.access_token.trim()) {
            console.error("[meta] 장기 토큰 교환 실패 — 단기 토큰으로 연결:", data.error?.code ?? "응답 형식 오류");
            return fallback;
        }
        return { accessToken: data.access_token, expiresAt: expiresAtFrom(data.expires_in, now), longLived: true };
    } catch (err) {
        console.error("[meta] 장기 토큰 교환 요청 실패 — 단기 토큰으로 연결:", err instanceof Error ? err.name : "unknown");
        return fallback;
    }
}

/** 토큰 오류를 받은 플랫폼을 '만료됨'으로 바꿔 화면이 계속 '연결됨'으로 보이지 않게 한다 */
export async function markMetaPlatformExpired(platformId: number, exec: Pick<typeof db, "update"> = db): Promise<void> {
    await exec
        .update(adPlatforms)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(eq(adPlatforms.id, platformId), eq(adPlatforms.platform, "meta")));
}
