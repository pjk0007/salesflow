import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "path";
import postgres from "postgres";

export async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
        return;
    }

    console.log("마이그레이션 시작...");
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);

    await migrate(db, {
        migrationsFolder: path.join(process.cwd(), "drizzle"),
    });

    console.log("마이그레이션 완료!");
    await client.end();
}
