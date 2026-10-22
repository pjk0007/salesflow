import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error("DATABASE_URL 환경 변수가 설정되지 않았습니다.");
}

/**
 * 연결 풀 크기. 정기 작업들(발송 대기열·후속·반복·예약등록·알림톡·깊이 알림·회신 읽기·결과 맞추기·발신 건강)이 잠금용으로
 * 연결 하나씩을 회차 내내 쥐고(queryClient.reserve) 그 안에서 풀 db를 또 쓴다. postgres-js 기본 10이면 작업이 겹칠 때
 * 풀이 바닥나 서로 기다리다 멈출 수 있다 (F5) — 기본 20, DATABASE_POOL_MAX로 바꾼다 (DB 연결 한도 안에서)
 */
function poolMax(): number {
    const raw = (process.env.DATABASE_POOL_MAX ?? "").trim();
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(n) && n >= 5 && n <= 200 ? n : 20;
}

/**
 * 풀 연결의 기본 쿼리 시간 제한(ms). 제한이 없으면 느린 조회가 끝날 때까지 연결을 쥐어 풀이 바닥나고 사이트 전체가 멈춘다
 * (2026-10-22 장애) — 기본 60초, DATABASE_STATEMENT_TIMEOUT_MS로 바꾸고 0이면 끈다.
 * 더 오래 걸리는 정기 작업은 reserve()한 연결에서 SET statement_timeout으로 따로 정한다(RESET하면 이 값으로 돌아온다).
 */
export function statementTimeoutMs(raw = process.env.DATABASE_STATEMENT_TIMEOUT_MS): number {
    const value = (raw ?? "").trim();
    const n = /^\d+$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(n) && n <= 3_600_000 ? n : 60_000;
}

export const queryClient = postgres(connectionString, {
    max: poolMax(),
    connection: { statement_timeout: statementTimeoutMs() },
});
export const db = drizzle(queryClient, { schema });

export * from "./schema";
