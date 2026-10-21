import type postgres from "postgres";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
export type StatsConn = Pick<postgres.Sql, "unsafe">;
export interface WriteStats {
    written: number;
    deleted: number;
}

export async function executeSql(conn: StatsConn, fragment: SQL): Promise<WriteStats> {
    const query = new PgDialect().sqlToQuery(fragment);
    const rows = await conn.unsafe<WriteStats[]>(query.sql, query.params as postgres.ParameterOrJSON<never>[]);
    return { written: rows[0]?.written ?? 0, deleted: rows[0]?.deleted ?? 0 };
}
