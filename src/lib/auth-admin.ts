import type { NextRequest } from "next/server";
import { getUserFromNextRequest, resolveActiveUser } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";
import { hasMinRole } from "./auth-admin-rules";

export {
    checkTokenVersion,
    isTokenVersionAcceptable,
    hasMinRole,
} from "./auth-admin-rules";
export type { TokenVersionCheck } from "./auth-admin-rules";

export type AdminAuthResult =
    | { ok: true; user: JWTPayload }
    | { ok: false; status: 401 | 403; error: string };

const NEED_AUTH = "인증이 필요합니다." as const;
const SESSION_EXPIRED = "세션이 만료되었습니다. 다시 로그인해주세요." as const;
const FORBIDDEN = "접근 권한이 없습니다." as const;

/**
 * 관리자 경로의 단일 진입점.
 *
 * getActiveUserFromNextRequest와 같은 DB 확인(현재 멤버십·계정 활성·token_version)을 거친 뒤
 * **DB의 현재 role**로 최소 역할을 판정한다.
 *   - 토큰 없음·서명 무효 → 401 "인증이 필요합니다."
 *   - 조직에서 제거·계정 비활성·역할 변경 뒤 재로그인 전 → 401 "세션이 만료되었습니다…"
 *   - 역할 부족 → 403 "접근 권한이 없습니다."
 *
 * 반환되는 user.role·isSuperAdmin은 DB 값이므로 호출부가 세부 분기를 해도 최신 값을 본다.
 */
export async function requireAdmin(
    req: NextRequest,
    minRole: OrgRole = "admin"
): Promise<AdminAuthResult> {
    const payload = getUserFromNextRequest(req);
    if (!payload) {
        return { ok: false, status: 401, error: NEED_AUTH };
    }

    const user = await resolveActiveUser(payload);
    if (!user) {
        return { ok: false, status: 401, error: SESSION_EXPIRED };
    }

    if (!hasMinRole(user.role, minRole)) {
        return { ok: false, status: 403, error: FORBIDDEN };
    }

    return { ok: true, user };
}
