import { sql } from "drizzle-orm";

/**
 * 트래커 분석의 세그먼트 필터 SQL 조각.
 *
 * funnel·overview·engagement route에 같은 구현이 중복돼 있었다.
 * 웹과 MCP가 같은 수치를 내려면 조각이 하나여야 한다.
 *
 * notExcludedExpr은 여기 두지 않는다 — funnel과 overview가 의미는 같지만
 * 표현이 달라(인라인 정규식 vs PATH_EXPR 상수), 합치면 mechanical move의
 * 범위를 벗어난다. 각 route에 그대로 남긴다.
 */

/** device 필터. null이면 조각을 만들지 않는다. */
export function deviceFilterSql(device: string | null, visitorAlias = "tv") {
    return device ? sql.raw(`AND ${visitorAlias}.device_type = '${device.replace(/'/g, "")}'`) : sql``;
}

/**
 * 세션 ID 목록 필터(채널 필터 결과).
 * null이면 미적용, 빈 배열이면 매칭 0이므로 전부 제외한다.
 */
export function sessionInFilterSql(sessionIds: number[] | null, sessionCol: string) {
    if (sessionIds === null) return sql``;
    if (sessionIds.length === 0) return sql.raw(`AND FALSE`);
    return sql`AND ${sql.raw(sessionCol)} IN (${sql.join(sessionIds.map((id) => sql`${id}`), sql`, `)})`;
}
