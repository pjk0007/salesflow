import { and, eq, gt, isNull, lt, or, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
/**
 * (시각 desc, id desc) 목록의 다음 페이지 조건. 무작위 UUID 순서 대신 새 항목이 먼저 오게 한다(UX-087).
 * cursor는 이전 페이지 마지막 행의 실제 값(같은 범위에서 다시 읽은 것)이다.
 */
export function newerFirstAfter(
    at: PgColumn,
    id: PgColumn,
    cursor?: { at: Date; id: string } | null,
): SQL | undefined {
    return cursor
        ? or(lt(at, cursor.at), and(eq(at, cursor.at), lt(id, cursor.id)))
        : undefined;
}
/** (마감 asc nulls last, id asc) 목록의 다음 페이지 조건 — 할 일 마감 순서. */
export function dueFirstAfter(
    due: PgColumn,
    id: PgColumn,
    cursor?: { due: Date | null; id: string } | null,
): SQL | undefined {
    if (!cursor) return undefined;
    return cursor.due
        ? or(
              gt(due, cursor.due),
              and(eq(due, cursor.due), gt(id, cursor.id)),
              isNull(due),
          )
        : and(isNull(due), gt(id, cursor.id));
}
