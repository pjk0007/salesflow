/**
 * Postgres 고유 제약 위반(23505)인지. drizzle은 원래 오류를 cause에 담아 다시 던지므로
 * message 문자열만 보면 놓친다 ("Failed query: ..."로 시작한다)
 */
export function isUniqueViolation(error: unknown): boolean {
    const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined);
    return codeOf(error) === "23505" || (error instanceof Error && codeOf(error.cause) === "23505");
}

/**
 * 로그용 DB 오류 요약. drizzle 오류의 message에는 쿼리 파라미터(params: …)가 통째로 들어가서
 * 웹훅 주소 같은 비밀값을 다루는 곳에서는 원인(cause) 메시지만 남긴다
 */
export function describeDbError(error: unknown): string {
    if (error instanceof Error) {
        if (error.cause instanceof Error) return error.cause.message;
        return error.message.split("\nparams:")[0];
    }
    return String(error);
}
