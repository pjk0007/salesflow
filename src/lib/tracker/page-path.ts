import { sql } from "drizzle-orm";

/**
 * page_url에서 경로(path)만 추출하는 SQL 조각 — host 제거 + 쿼리스트링·해시 제거.
 * 해시를 안 떼면 앵커(#message-chat-N 등)마다 별개 페이지로 갈라짐.
 * 루트는 ''가 아닌 '/'로 정규화 — 페이지 필터의 "그룹 키"와 "매칭 키"가 항상 일치해야 함.
 */
export function pagePathExpr(col: string) {
    return sql`COALESCE(NULLIF(regexp_replace(split_part(split_part(${sql.raw(col)}, '#', 1), '?', 1), '^https?://[^/]+', ''), ''), '/')`;
}
