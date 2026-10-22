/**
 * 발송 로그·records 색인을 부팅 뒤 트랜잭션 밖에서 CONCURRENTLY로 만든다 (DESIGN-SND 8-3, SND-15 — DESIGN-RPL과 같은 결론).
 *
 * 마이그레이션(한 트랜잭션) 안에서 만들면 같은 트랜잭션의 ALTER TABLE … ADD COLUMN이 쥔 ACCESS EXCLUSIVE 잠금이 커밋까지 남아
 * 색인을 만드는 내내 그 표의 읽기까지 막힌다 (클릭 추적·수신거부 토큰·깊이 알림·대기열 워커가 멈춘다).
 * CONCURRENTLY는 읽기·쓰기를 막지 않는다 — 만드는 시간만 길어진다.
 *
 * - instrumentation.ts가 runMigrations() 뒤에 기다리지 않고(void) 부른다 — 서버가 뜨는 것을 늦추지 않는다
 * - 전용 연결 하나(max 1)로 pg_try_advisory_lock(0x5c4edf0a) — 못 잡으면 다른 인스턴스가 하고 있으니 그만
 * - 지난번 실패해 INVALID로 남은 같은 이름 색인이 있으면 지우고 다시 만든다
 * - 실패해도 서버는 그대로다. 오류 객체를 통째로 찍지 않는다 (다음 부팅에 다시)
 * 색인이 생기기 전에는 건강 판정이 그 회차를 건너뛰고(sender-health.ts), 동기화·회신 조회는 느리게 돈다.
 */
import postgres from "postgres";

export const SEND_LOG_INDEX_LOCK_KEY = 0x5c4edf0a;

/** schema.ts의 색인 선언과 같은 이름 */
export const SEND_LOG_INDEXES: ReadonlyArray<{ name: string; ddl: string }> = [
    {
        name: "records_org_created_at_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "records_org_created_at_idx" ON "records" ("org_id", "created_at")`,
    },
    {
        name: "email_send_logs_org_sent_at_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_sent_at_idx" ON "email_send_logs" ("org_id", "sent_at")`,
    },
    {
        name: "email_send_logs_request_id_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_request_id_idx" ON "email_send_logs" ("request_id") WHERE "request_id" IS NOT NULL`,
    },
    {
        name: "email_send_logs_org_recipient_lower_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_recipient_lower_idx" ON "email_send_logs" ("org_id", lower("recipient_email"))`,
    },
    // 발송 직전 중복 확인(같은 파티션·같은 규칙에 이 주소로 보냈나)과 레코드별 발송 조회가 매번 표 전체를 훑어
    // 디스크 읽기로 연결 풀이 바닥났다 (2026-10-22 운영 장애)
    {
        name: "email_send_logs_partition_recipient_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_partition_recipient_idx" ON "email_send_logs" ("partition_id", "recipient_email")`,
    },
    {
        name: "email_send_logs_template_link_recipient_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_template_link_recipient_idx" ON "email_send_logs" ("template_link_id", "recipient_email") WHERE "template_link_id" IS NOT NULL`,
    },
    {
        name: "email_send_logs_record_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_record_idx" ON "email_send_logs" ("record_id") WHERE "record_id" IS NOT NULL`,
    },
];

function shortError(e: unknown): string {
    if (e && typeof e === "object") {
        const code = (e as { code?: unknown }).code;
        const message = (e as { message?: unknown }).message;
        return `${typeof code === "string" ? code + " " : ""}${typeof message === "string" ? message.slice(0, 200) : ""}`.trim();
    }
    return String(e).slice(0, 200);
}

/** 두 색인이 모두 있고 쓸 수 있나 (indisvalid). 건강 판정이 큰 표 전체를 훑지 않으려고 본다 */
export const SEND_LOG_INDEXES_READY_SQL = `
    SELECT count(*)::int AS ready
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN ('email_send_logs_org_sent_at_idx', 'email_send_logs_request_id_idx')
      AND i.indisvalid
`;

export const RECORDS_INDEX_READY_SQL = `
    SELECT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relname = 'records_org_created_at_idx'
          AND i.indisvalid
    ) AS ready
`;

export async function ensureSendLogIndexes(connectionString: string | undefined = process.env.DATABASE_URL): Promise<void> {
    if (!connectionString) return;
    const started = Date.now();
    let client: postgres.Sql | null = null;
    let locked = false;
    try {
        client = postgres(connectionString, { max: 1, onnotice: () => {} });
        const lock = await client<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${SEND_LOG_INDEX_LOCK_KEY}) AS ok`;
        locked = lock[0]?.ok === true;
        if (!locked) {
            console.log("[indexes] 다른 인스턴스가 email_send_logs·records 색인을 만드는 중 — 건너뜀");
            return;
        }
        // 이 연결에서만 시간 제한을 끈다 (큰 표는 몇 분 걸릴 수 있다)
        await client.unsafe("SET statement_timeout = 0");
        let created = 0;
        for (const idx of SEND_LOG_INDEXES) {
            const rows = await client<{ valid: boolean }[]>`
                SELECT i.indisvalid AS valid
                FROM pg_class c
                JOIN pg_index i ON i.indexrelid = c.oid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = current_schema() AND c.relname = ${idx.name}
            `;
            if (rows.length > 0 && rows[0].valid) continue;
            if (rows.length > 0 && !rows[0].valid) {
                // 지난번 CONCURRENTLY가 중간에 실패해 INVALID로 남았다 — IF NOT EXISTS가 건너뛰지 않게 지우고 다시
                await client.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${idx.name}"`);
            }
            await client.unsafe(idx.ddl);
            created++;
        }
        const secs = Math.round((Date.now() - started) / 100) / 10;
        console.log(`[indexes] email_send_logs·records 색인 준비됨 (${secs}초${created > 0 ? `, 새로 ${created}개` : ""})`);
    } catch (e) {
        console.error(`[indexes] email_send_logs·records 색인 만들기 실패 — 다음 부팅에 다시: ${shortError(e)}`);
    } finally {
        if (client) {
            try {
                if (locked) await client`SELECT pg_advisory_unlock(${SEND_LOG_INDEX_LOCK_KEY})`;
            } catch {
                // 연결이 끊겼으면 잠금도 함께 풀렸다
            }
            await client.end({ timeout: 5 }).catch(() => undefined);
        }
    }
}
