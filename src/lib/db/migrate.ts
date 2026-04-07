import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import postgres from "postgres";

// 기존에 drizzle-kit push로 실제 적용된 마이그레이션 목록 (최초 1회 시딩용)
// 주의: 실제 push된 것만 포함 (0022까지). 0023+ 는 migrate()가 SQL 실행
const EXISTING_MIGRATIONS = [
    { hash: "0000_premium_luke_cage", created_at: 1770946331787 },
    { hash: "0001_email_configs_nhn", created_at: 1770946400000 },
    { hash: "0002_email_template_status", created_at: 1770946500000 },
    { hash: "0003_email_categories", created_at: 1770946600000 },
    { hash: "0004_web_forms", created_at: 1770946700000 },
    { hash: "0005_dashboards", created_at: 1770946800000 },
    { hash: "0006_dashboard_partition_ids", created_at: 1770946900000 },
    { hash: "0007_onboarding", created_at: 1770947000000 },
    { hash: "0008_billing", created_at: 1770947100000 },
    { hash: "0009_multi_org", created_at: 1770947200000 },
    { hash: "0010_subscription_card_info", created_at: 1770947300000 },
    { hash: "0011_workspace_code_prefix", created_at: 1770947400000 },
    { hash: "0012_missing_tables", created_at: 1770947500000 },
    { hash: "0013_alimtalk_repeat_config", created_at: 1770947600000 },
    { hash: "0014_api_token_scopes", created_at: 1770947700000 },
    { hash: "0015_email_auto_personalized", created_at: 1770947800000 },
    { hash: "0016_billing_retry", created_at: 1770947900000 },
    { hash: "0017_email_signature", created_at: 1770948000000 },
    { hash: "0018_ai_usage_quotas", created_at: 1770948100000 },
    { hash: "0019_auto_email_format", created_at: 1770948200000 },
    { hash: "0020_signature_persona", created_at: 1770948300000 },
    { hash: "0021_auto_enrich", created_at: 1770948400000 },
    { hash: "0022_email_log_body", created_at: 1770948500000 },
];

// 이전에 잘못 시딩된 마이그레이션 (push 안 됐는데 기록만 들어간 것)
// 이전에 잘못 시딩되었거나, SQL 미실행 상태로 기록된 마이그레이션
const INCORRECTLY_SEEDED = [
    "0023_email_read_tracking",
    "0024_email_sender_signatures",
    "0025_email_followup",
    "0026_followup_chain",
    "0027_duplicate_prevention",
];

// DB에 직접 적용(push)되었지만 마이그레이션 기록이 없는 것 — 기록만 삽입
const MANUALLY_APPLIED = [
    { hash: "0037_ai_email_sender_fields", created_at: 1770949000000 },
];

async function seedMigrationHistory(client: postgres.Sql) {
    // 실제 테이블이 존재하는지 확인 (drizzle-kit push로 이미 적용된 DB인지)
    const tableCheck = await client`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'users'
        ) as exists
    `;
    const tablesExist = tableCheck[0].exists;

    if (!tablesExist) {
        // 새 DB — 잘못 시딩된 기록이 있으면 정리하고 전체 마이그레이션 실행
        console.log("[migrate] 새 DB 감지, 전체 마이그레이션 실행");
        await client`DROP TABLE IF EXISTS "drizzle"."__drizzle_migrations"`;
        await client`DROP SCHEMA IF EXISTS "drizzle"`;
        return;
    }

    // 기존 DB — __drizzle_migrations 기록이 없으면 시딩
    await client`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
    await client`
        CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
            id serial PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `;

    const existing = await client`SELECT count(*) as cnt FROM "drizzle"."__drizzle_migrations"`;
    const cnt = Number(existing[0].cnt);

    if (cnt > 0) {
        // 잘못 시딩된 기록 정리 (push 안 됐는데 기록만 들어간 것)
        for (const hash of INCORRECTLY_SEEDED) {
            const del = await client`DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}`;
            if (del.count > 0) {
                console.log(`[migrate] 잘못 시딩된 기록 제거: ${hash}`);
            }
        }
        // DB에 직접 적용되었지만 기록이 없는 마이그레이션 삽입
        for (const m of MANUALLY_APPLIED) {
            const exists = await client`SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = ${m.hash} LIMIT 1`;
            if (exists.length === 0) {
                await client`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${m.hash}, ${m.created_at})`;
                console.log(`[migrate] 수동 적용 기록 추가: ${m.hash}`);
            }
        }
        return;
    }

    console.log("[migrate] 기존 DB 감지, 마이그레이션 기록 시딩...");
    for (const m of EXISTING_MIGRATIONS) {
        await client`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${m.hash}, ${m.created_at})`;
    }
    console.log(`[migrate] 시딩 완료 (${EXISTING_MIGRATIONS.length}개)`);
}

export async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("[migrate] DATABASE_URL 환경변수가 설정되지 않았습니다.");
        return;
    }

    console.log("[migrate] 마이그레이션 시작...");
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);

    try {
        await seedMigrationHistory(client);
        await migrate(db, {
            migrationsFolder: path.join(process.cwd(), "drizzle"),
        });
        console.log("[migrate] 마이그레이션 완료!");
    } catch (err) {
        console.error("[migrate] 마이그레이션 에러:", err);
    } finally {
        await client.end();
    }
}
