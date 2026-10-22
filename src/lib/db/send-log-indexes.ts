/**
 * email_send_logs 조회 색인을 부팅 뒤 트랜잭션 밖에서 CONCURRENTLY로 만든다.
 *
 * 마이그레이션(한 트랜잭션) 안에서 만들면 같은 트랜잭션의 ALTER TABLE … ADD COLUMN이 쥔 ACCESS EXCLUSIVE 잠금이 커밋까지 남아
 * 색인을 만드는 내내 그 표의 읽기까지 막힌다 (클릭 추적·수신거부 토큰·깊이 알림·대기열 워커가 멈춘다).
 * CONCURRENTLY는 읽기·쓰기를 막지 않는다 — 만드는 시간만 길어진다.
 *
 * - instrumentation.ts가 runMigrations() 뒤에 기다리지 않고(void) 부른다 — 서버가 뜨는 것을 늦추지 않는다
 * - 전용 연결 하나(max 1)로 pg_try_advisory_lock(0x5c4edf0a) — 못 잡으면 다른 인스턴스가 하고 있으니 그만
 * - 지난번 실패해 INVALID로 남은 같은 이름 색인이 있으면 지우고 다시 만든다
 * - 색인별 실패를 격리하고 재부팅 없이 최대 3회 재시도한다. 오류에는 SQL/파라미터를 넣지 않는다.
 * 색인이 생기기 전에는 건강 판정이 그 회차를 건너뛰고(sender-health.ts), 동기화·회신 조회는 느리게 돈다.
 */
import postgres from "postgres";

export const SEND_LOG_INDEX_LOCK_KEY = 0x5c4edf0a;

/** schema.ts의 emailSendLogs 색인 선언과 같은 이름 */
export const SEND_LOG_INDEXES: ReadonlyArray<{ name: string; ddl: string }> = [
    // Keep these incident-critical lookups ahead of less urgent index work.
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
    {
        name: "email_send_logs_org_recipient_lower_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_recipient_lower_idx" ON "email_send_logs" ("org_id", lower("recipient_email"))`,
    },
    {
        name: "email_send_logs_org_sent_at_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_org_sent_at_idx" ON "email_send_logs" ("org_id", "sent_at")`,
    },
    {
        name: "email_send_logs_request_id_idx",
        ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_send_logs_request_id_idx" ON "email_send_logs" ("request_id") WHERE "request_id" IS NOT NULL`,
    },
];

function shortError(e: unknown): string {
    const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
    return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "unknown";
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

interface IndexBuildOptions {
    attempts?: number;
    retryDelayMs?: number;
    statementTimeoutMs?: number;
    lockTimeoutMs?: number;
}
export interface IndexBuildResult { ready: boolean; skippedAsLocked?: boolean; failed: string[] }

export async function ensureSendLogIndexes(
    connectionString: string | undefined = process.env.DATABASE_URL,
    options: IndexBuildOptions = {},
): Promise<IndexBuildResult> {
    if (!connectionString) return { ready: false, failed: ["DATABASE_URL"] };
    const attempts = options.attempts ?? 3;
    let result: IndexBuildResult = { ready: false, failed: [] };
    for (let attempt = 1; attempt <= attempts; attempt++) {
        result = await buildIndexesOnce(connectionString, options);
        if (result.ready || result.skippedAsLocked) return result;
        if (attempt < attempts) {
            console.warn(`[indexes] 준비되지 않은 색인 ${result.failed.length}개 — 다음 회차 재시도 (${attempt}/${attempts})`);
            await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 60_000));
        }
    }
    return result;
}

async function buildIndexesOnce(connectionString: string, options: IndexBuildOptions): Promise<IndexBuildResult> {
    const started = Date.now();
    let client: postgres.Sql | null = null;
    let locked = false;
    const failed: string[] = [];
    try {
        client = postgres(connectionString, {
            max: 1, connect_timeout: 10, max_lifetime: 0, idle_timeout: 0, onnotice: () => {},
            connection: {
                statement_timeout: options.statementTimeoutMs ?? 600_000,
                lock_timeout: options.lockTimeoutMs ?? 5_000,
                application_name: "sendb-index-builder",
            },
        });
        const lock = await client<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${SEND_LOG_INDEX_LOCK_KEY}) AS ok`;
        locked = lock[0]?.ok === true;
        if (!locked) {
            console.log("[indexes] 다른 인스턴스가 email_send_logs 색인을 만드는 중 — 건너뜀");
            return { ready: false, skippedAsLocked: true, failed: [] };
        }
        let created = 0;
        for (const idx of SEND_LOG_INDEXES) {
            try {
                const rows = await client<{ valid: boolean }[]>`
                    SELECT i.indisvalid AS valid
                    FROM pg_class c
                    JOIN pg_index i ON i.indexrelid = c.oid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = current_schema() AND c.relname = ${idx.name}
                `;
                if (rows.length > 0 && rows[0].valid) continue;
                if (rows.length > 0 && !rows[0].valid) {
                    // IF NOT EXISTS alone would preserve a failed INVALID index.
                    await client.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${idx.name}"`);
                }
                await client.unsafe(idx.ddl);
                created++;
            } catch (error) {
                failed.push(idx.name);
                console.error(`[indexes] ${idx.name} 준비 실패: ${shortError(error)}`);
            }
        }
        const secs = Math.round((Date.now() - started) / 100) / 10;
        console.log(`[indexes] email_send_logs 색인 확인 (${secs}초, 새로 ${created}개, 실패 ${failed.length}개)`);
        return { ready: failed.length === 0, failed };
    } catch (e) {
        console.error(`[indexes] email_send_logs 색인 연결 실패: ${shortError(e)}`);
        return { ready: false, failed: SEND_LOG_INDEXES.map((index) => index.name) };
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
