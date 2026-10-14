/** 인증 검증은 서버가 수행한다. 이 값은 동일 회원의 인증 갱신 때 작성 중인 초안을 보존하는 용도다. */
export function draftSessionKey(token: string): string {
    if (!token.includes(".")) return token;
    try {
        const payload = JSON.parse(
            atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        );
        if (
            payload.kind === "sendb-customer" &&
            typeof payload.sub === "string" &&
            typeof payload.aud === "string"
        )
            return `${payload.aud}:${payload.sub}`;
    } catch {
        /* 잘못된 인증은 서버 응답에서 처리한다. */
    }
    return token;
}
