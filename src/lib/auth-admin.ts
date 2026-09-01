import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, organizationMembers } from "@/lib/db";
import { getUserFromNextRequest } from "@/lib/auth";
import type { JWTPayload, OrgRole } from "@/types";
import { checkTokenVersion, isTokenVersionAcceptable, hasMinRole } from "./auth-admin-rules";

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
 * getUserFromNextRequest와 달리 DB를 본다:
 *   - organization_members에서 현재 role과 token_version을 읽는다
 *   - 토큰의 tokenVersion이 DB와 다르면 401 (role이 바뀐 뒤 재로그인 전)
 *   - role 판정은 JWT가 아니라 **DB의 현재 role**로 한다
 *
 * 반환되는 user.role은 DB 값으로 덮어써지므로, 호출부가 user.role로 세부 분기를 해도
 * 최신 값을 본다.
 *
 * 이 헬퍼를 쓰는 경로 = 관리자 경로다. 조직·빌링·권한 관리 계열이 여기 해당하고,
 * 일반 데이터 route는 getUserFromNextRequest를 그대로 쓴다(role 반영이 지연된다).
 */
export async function requireAdmin(
    req: NextRequest,
    minRole: OrgRole = "admin"
): Promise<AdminAuthResult> {
    const payload = getUserFromNextRequest(req);
    if (!payload) {
        return { ok: false, status: 401, error: NEED_AUTH };
    }

    const [membership] = await db
        .select({
            role: organizationMembers.role,
            tokenVersion: organizationMembers.tokenVersion,
        })
        .from(organizationMembers)
        .where(
            and(
                eq(organizationMembers.organizationId, payload.orgId),
                eq(organizationMembers.userId, payload.userId)
            )
        );

    // 조직에서 제거됐거나 토큰의 orgId가 더 이상 유효하지 않다
    if (!membership) {
        return { ok: false, status: 401, error: SESSION_EXPIRED };
    }

    const versionCheck = checkTokenVersion(payload.tokenVersion, membership.tokenVersion);
    if (!isTokenVersionAcceptable(versionCheck)) {
        return { ok: false, status: 401, error: SESSION_EXPIRED };
    }

    if (!hasMinRole(membership.role, minRole)) {
        return { ok: false, status: 403, error: FORBIDDEN };
    }

    return {
        ok: true,
        user: { ...payload, role: membership.role as OrgRole },
    };
}
