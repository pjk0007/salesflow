import { records } from "./schema";
import { SEND_LOG_INDEXES } from "./send-log-indexes";
import { PGlite } from "@electric-sql/pglite";
import { SQL } from "drizzle-orm";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";

export type TaggedSql = <T>(strings: TemplateStringsArray, ...params: unknown[]) => Promise<T>;
export interface CapturedQuery { text: string; params: unknown[]; rows: Record<string, unknown>[] }
export interface PlanNode {
    "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Index Cond"?: string;
    "Actual Loops"?: number; "Recheck Cond"?: string; Plans?: PlanNode[];
}
export function sqlLiteral(value: unknown): string {
    if (value === null) return "NULL";
    if (value instanceof Date) return sqlLiteral(value.toISOString());
    if (Array.isArray(value)) return value.length ? `ARRAY[${value.map(sqlLiteral).join(",")}]` : "'{}'";
    if (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") return String(value);
    if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
    throw new Error("Unsupported SQL literal");
}
export async function openPglite(tables: PgTable[]): Promise<PGlite> {
    const pg = new PGlite();
    const dialect = new PgDialect();
    try {
        for (const table of tables) {
            const config = getTableConfig(table);
            const columns = config.columns.map(c => {
                const value = c.default;
                const expression = value instanceof SQL ? dialect.sqlToQuery(value).sql
                    : sqlLiteral(typeof value === "object" && value !== null ? JSON.stringify(value) : value ?? null);
                return `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}${c.notNull ? " NOT NULL" : ""}${value === undefined ? "" : ` DEFAULT ${expression}`}`;
            });
            await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
        }
        return pg;
    } catch (error) {
        await pg.close();
        throw error;
    }
}
export async function insertRow(pg: PGlite, table: string, row: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(row);
    await pg.query(`INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
}
export function pgliteTag(pg: PGlite, log: CapturedQuery[] = []): TaggedSql {
    return async <T>(strings: TemplateStringsArray, ...params: unknown[]): Promise<T> => {
        for (const p of params) {
            if (p === undefined || typeof p === "function" || p !== null && typeof p === "object" && !Array.isArray(p) && !(p instanceof Date)) {
                throw new Error("SQL fragments and unsupported parameters are forbidden");
            }
        }
        const text = strings.reduce((s, part, i) => s + part + (i < params.length ? `$${i + 1}` : ""), "");
        const { rows } = await pg.query<Record<string, unknown>>(text, params);
        log.push({ text, params, rows });
        return rows as T;
    };
}

export async function createRecordEmailIndex(pg: PGlite): Promise<void> {
    const index = SEND_LOG_INDEXES.find(i => i.name === "records_workspace_email_norm_idx");
    if (!index) throw new Error("records email index DDL is missing");
    try {
        await pg.exec(index.ddl);
    } catch (error) {
        // PGlite가 CONCURRENTLY를 지원하지 않는 경우에만 동일한 식을 일반 CREATE로 검증한다.
        if (!(error instanceof Error) || !/CONCURRENTLY/i.test(error.message)) throw error;
        await pg.exec(index.ddl.replace("CONCURRENTLY ", ""));
    }
}
export async function setIndexValid(pg: PGlite, name: string, valid: boolean): Promise<void> {
    await pg.query("UPDATE pg_index SET indisvalid = $2 WHERE indexrelid = $1::regclass", [name, valid]);
}
export async function explainPrepared(pg: PGlite, q: { text: string; params: unknown[] },
    o: { mode: "generic" | "custom"; analyze: boolean }): Promise<PlanNode> {
    await pg.exec("SET enable_seqscan = off");
    let isPrepared = false;
    try {
        await pg.exec(`PREPARE journey_plan AS ${q.text}`);
        isPrepared = true;
        await pg.exec(`SET plan_cache_mode = force_${o.mode}_plan`);
        const { rows } = await pg.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(
            `EXPLAIN (${o.analyze ? "ANALYZE, " : ""}FORMAT JSON) EXECUTE journey_plan(${q.params.map(sqlLiteral).join(",")})`);
        return rows[0]["QUERY PLAN"][0].Plan;
    } finally {
        if (isPrepared) await pg.exec("DEALLOCATE journey_plan");
        await pg.exec("RESET enable_seqscan; RESET plan_cache_mode");
    }
}
export function planNodes(root: PlanNode): PlanNode[] {
    return [root, ...(root.Plans ?? []).flatMap(planNodes)];
}
export function usesIndex(root: PlanNode, name: string): boolean {
    return planNodes(root).some(node => node["Index Name"] === name);
}
export function executedFullScans(root: PlanNode, relation: string): PlanNode[] {
    return planNodes(root).filter(node => {
        if (node["Relation Name"] !== relation || (node["Actual Loops"] ?? 0) <= 0) return false;
        if (node["Node Type"] === "Seq Scan") return true;
        if (!["Index Scan", "Index Only Scan", "Bitmap Heap Scan"].includes(node["Node Type"])) return false;
        const condition = node["Index Cond"] ?? node["Recheck Cond"];
        if (!condition) return true;
        // 선두 workspace/org만 찾는 복합 인덱스도 테넌트의 records 전체를 읽는다.
        const expression = condition.replace(/'(?:[^']|'')*'/g, "");
        const columns = getTableConfig(records).columns.filter(c => new RegExp(`\\b${c.name}\\b`).test(expression));
        return relation === "records" && columns.length > 0 && columns.every(c => ["workspace_id", "org_id"].includes(c.name));
    });
}
