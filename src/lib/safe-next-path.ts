/**
 * 로그인 뒤 돌아갈 주소 (?next=) — 같은 사이트 안의 경로만 받는다 (다른 사이트로 보내는 열린 리다이렉트를 막는다).
 * 구글 챗 카드의 "레코드 열기"를 로그인 안 된 직원이 눌러도 로그인 뒤 그 레코드로 돌아가게 (DV-12)
 */
export function safeNextPath(raw: string | null | undefined): string | null {
    const v = (raw ?? "").trim();
    if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
    if (/[\u0000-\u001f]/.test(v)) return null;
    if (v === "/login" || v.startsWith("/login?") || v.startsWith("/login/")) return null;
    return v.slice(0, 2000);
}
