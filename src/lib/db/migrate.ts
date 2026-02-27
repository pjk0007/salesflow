import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import postgres from "postgres";

// 기존에 drizzle-kit push로 적용된 마이그레이션 목록 (최초 1회 시딩용)
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
    if (Number(existing[0].cnt) > 0) return;

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
