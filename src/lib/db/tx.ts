import type { db } from "@/lib/db";

/**
 * db.transaction 콜백이 받는 트랜잭션 (중첩 tx.transaction은 저장점이다).
 * 트랜잭션 안에서도 밖에서도 부를 수 있는 함수는 `exec: DbExec = db`처럼 받는다.
 */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExec = typeof db | DbTx;
