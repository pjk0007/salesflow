import type { OrgRole } from "@/types";

/**
 * 토큰의 버전과 DB의 버전을 대조한 결과.
 *
 * - "ok"      : 유효
 * - "stale"   : role이 바뀐 뒤 발급된 토큰이 아니다. 재로그인 필요
 * - "missing" : payload에 tokenVersion이 없다 (tokenVersion 도입 이전 발급)
 */
export type TokenVersionCheck = "ok" | "stale" | "missing";

/**
 * DB를 보지 않는 순수 함수.
 *
 * tokenVersion이 없는 구버전 토큰은 0으로 간주하되 결과는 "missing"으로 구별해 돌려준다 —
 * 통과 여부는 isTokenVersionAcceptable이 정하므로, 정책을 바꿀 때 고칠 곳이 하나로 모인다.
 *
 * 버전이 다르면 작든 크든 거부한다. 롤백이나 복제 지연으로 토큰 쪽이 앞설 수도 있는데,
 * 그때도 통과시키지 않는 것이 fail-closed다.
 */
export function checkTokenVersion(
    tokenVersion: number | undefined,
    dbVersion: number
): TokenVersionCheck {
    if (tokenVersion === undefined) {
        return dbVersion === 0 ? "missing" : "stale";
    }
    return tokenVersion === dbVersion ? "ok" : "stale";
}

/**
 * 통과로 취급할 결과. 정책이 바뀌면 여기만 고친다.
 *
 * "missing"을 통과시키는 이유: 도입 이전에 발급된 토큰을 전부 거부하면 전원이 강제
 * 로그아웃된다. DB 버전이 0보다 크면(= 한 번이라도 role이 바뀌었으면) checkTokenVersion이
 * 이미 "stale"을 내므로 무효화가 필요한 경우는 놓치지 않는다.
 */
export function isTokenVersionAcceptable(result: TokenVersionCheck): boolean {
    // 화이트리스트로 쓴다 — 결과 종류가 늘어날 때 조용히 통과하지 않도록
    return result === "ok" || result === "missing";
}

const ROLE_ORDER: Record<string, number> = { member: 0, admin: 1, owner: 2 };

/**
 * owner > admin > member.
 *
 * 알 수 없는 role은 -1로 떨어뜨린다. api-handler.ts의 roleOrder는 `?? 0`(member 취급)을
 * 쓰는데, 그러면 minRole이 "member"일 때 미지의 role이 통과한다. 여기서는 fail-closed.
 */
export function hasMinRole(role: string, minRole: OrgRole): boolean {
    return (ROLE_ORDER[role] ?? -1) >= ROLE_ORDER[minRole];
}
