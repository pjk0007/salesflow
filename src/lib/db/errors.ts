/** Postgres SQLSTATE 판별. drizzle은 원래 오류를 cause에 담아 다시 던지므로 cause까지 본다 */
function hasSqlState(error: unknown, state: string): boolean {
    const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? (e as { code?: unknown }).code : undefined);
    return codeOf(error) === state || (error instanceof Error && codeOf(error.cause) === state);
}

/**
 * Postgres 고유 제약 위반(23505)인지. drizzle은 원래 오류를 cause에 담아 다시 던지므로
 * message 문자열만 보면 놓친다 ("Failed query: ..."로 시작한다)
 */
export function isUniqueViolation(error: unknown): boolean {
    return hasSqlState(error, "23505");
}

/**
 * Postgres 외래 키 위반(23503)인지 — 다른 기록이 아직 참조하는 행을 지우거나, 없는 행을 참조하려 할 때.
 * 삭제 경로는 이것으로 "서버 오류" 대신 무엇이 막는지 한국어 409로 알려준다
 */
export function isForeignKeyViolation(error: unknown): boolean {
    return hasSqlState(error, "23503");
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
