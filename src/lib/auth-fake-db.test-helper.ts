/**
 * 실제 DB 없이 라우트 권한 동작을 시험하는 가상 drizzle db.
 *
 * `db.select/insert/update/delete/execute/transaction`을 t.mock으로 바꿔, 체인 마지막의 await에서
 * respond(call)이 돌려준 행을 결과로 준다. where 조건은 PgDialect로 SQL 문자열·매개변수로 렌더링해 둔다 —
 * 시험은 "어느 표를 어떤 조건으로 읽고/쓰는지"와 "외부 호출·쓰기가 일어나지 않았는지"를 확인한다.
 * 네트워크·DB 연결은 열리지 않는다(DATABASE_URL은 닫힌 포트를 가리키게 둔다).
 */
import type { TestContext } from "node:test";
import { getTableName, isTable, type SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

export interface FakeCall {
    op: "select" | "insert" | "update" | "delete" | "execute";
    table?: string;
    joins: string[];
    /** where 조건(여러 번이면 AND로 이어 붙임)·execute SQL */
    sql: string;
    params: unknown[];
    values?: unknown;
    set?: unknown;
}

export type Responder = (call: FakeCall) => unknown[] | Error | undefined;

const dialect = new PgDialect();

function render(value: unknown): { sql: string; params: unknown[] } {
    if (!value) return { sql: "", params: [] };
    const query = dialect.sqlToQuery((value as SQLWrapper).getSQL());
    return { sql: query.sql, params: query.params };
}

function tableName(value: unknown): string | undefined {
    return isTable(value) ? getTableName(value) : undefined;
}

/** 시험용 환경 변수. 실제 서비스 접속값을 덮어 DB·외부 호출이 실수로도 나가지 않게 한다. */
export function isolateEnv(t: TestContext, extra: Record<string, string> = {}) {
    const keys = ["DATABASE_URL", "JWT_SECRET", ...Object.keys(extra)];
    const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
    process.env.JWT_SECRET = "f1-auth-route-test-only-not-a-real-secret";
    Object.assign(process.env, extra);
    t.after(() => {
        for (const [k, v] of Object.entries(before)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });
}

export function installFakeDb(t: TestContext, db: object, respond: Responder) {
    const calls: FakeCall[] = [];
    const chain = (call: FakeCall): unknown => {
        const target = function () {};
        const proxy: unknown = new Proxy(target, {
            get(_target, prop) {
                if (prop === "then") {
                    calls.push(call);
                    const result = respond(call);
                    const settled = result instanceof Error ? Promise.reject(result) : Promise.resolve(result ?? []);
                    return settled.then.bind(settled);
                }
                return (...args: unknown[]) => {
                    if (prop === "from") call.table = tableName(args[0]);
                    else if (prop === "innerJoin" || prop === "leftJoin") {
                        const name = tableName(args[0]);
                        if (name) call.joins.push(name);
                    } else if (prop === "where") {
                        const where = render(args[0]);
                        call.sql = call.sql ? `${call.sql} AND ${where.sql}` : where.sql;
                        call.params.push(...where.params);
                    } else if (prop === "values") call.values = args[0];
                    else if (prop === "set") call.set = args[0];
                    return proxy;
                };
            },
        });
        return proxy;
    };
    const fresh = (op: FakeCall["op"], table?: unknown): FakeCall => ({ op, table: tableName(table), joins: [], sql: "", params: [] });
    const target = db as Record<string, (...args: never[]) => unknown>;
    t.mock.method(target, "select", () => chain(fresh("select")));
    t.mock.method(target, "insert", (table: unknown) => chain(fresh("insert", table)));
    t.mock.method(target, "update", (table: unknown) => chain(fresh("update", table)));
    t.mock.method(target, "delete", (table: unknown) => chain(fresh("delete", table)));
    t.mock.method(target, "execute", (query: unknown) => {
        const call = fresh("execute");
        const rendered = render(query);
        call.sql = rendered.sql;
        call.params = rendered.params;
        return chain(call);
    });
    // 트랜잭션 콜백에는 같은 가상 db를 넘긴다(쓰기 순서는 calls에 그대로 남는다)
    t.mock.method(target, "transaction", async (fn: (tx: unknown) => unknown) => fn(db));
    return { calls };
}

/** 조직 멤버십 확인 질의(findActiveMembership)인지 — 세션 확인 응답을 정할 때 쓴다. */
export function isMembershipLookup(call: FakeCall): boolean {
    return call.op === "select" && call.table === "organization_members" && call.joins.includes("users") && call.sql.includes('"users"."is_active"');
}
