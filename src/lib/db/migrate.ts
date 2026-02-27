import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import fs from "fs";
import path from "path";
import postgres from "postgres";

export async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("[migrate] DATABASE_URL 환경변수가 설정되지 않았습니다.");
        return;
    }

    const migrationsFolder = path.join(process.cwd(), "drizzle");
    console.log("[migrate] cwd:", process.cwd());
    console.log("[migrate] migrationsFolder:", migrationsFolder);
    console.log("[migrate] folder exists:", fs.existsSync(migrationsFolder));

    if (fs.existsSync(migrationsFolder)) {
        const files = fs.readdirSync(migrationsFolder);
        console.log("[migrate] files:", files.join(", "));
    }

    console.log("[migrate] 마이그레이션 시작...");
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);

    try {
        await migrate(db, { migrationsFolder });
        console.log("[migrate] 마이그레이션 완료!");
    } catch (err) {
        console.error("[migrate] 마이그레이션 에러:", err);
    } finally {
        await client.end();
    }
}
