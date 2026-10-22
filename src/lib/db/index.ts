import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { poolMax, statementTimeoutMs } from "./connection-options";
export { statementTimeoutMs } from "./connection-options";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL 환경 변수가 설정되지 않았습니다.");
}

/**
 * 일반 조회 풀은 기본 20개다. 잠금만 보유하는 정기 작업 8종은 worker-lock.ts의 별도 연결(최대 4개)을 쓴다.
 * DATABASE_POOL_MAX는 이 조회 풀의 한도이며, DB 전체 한도에는 잠금·색인·전자서명 등 별도 연결도 포함해야 한다.
 * statement_timeout은 서버에서 실행 중인 쿼리를 제한한다. JS 풀의 연결 대기 시간까지 제한하지는 않는다.
 */
export const queryClient = postgres(connectionString, {
    max: poolMax(),
    connection: { statement_timeout: statementTimeoutMs() },
});
export const db = drizzle(queryClient, { schema });

export * from "./schema";
