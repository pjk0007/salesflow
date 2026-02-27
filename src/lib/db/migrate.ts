import { execSync } from "child_process";

export async function runMigrations() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("[migrate] DATABASE_URL 환경변수가 설정되지 않았습니다.");
        return;
    }

    console.log("[migrate] drizzle-kit push 시작...");
    try {
        const output = execSync("npx drizzle-kit push --force", {
            env: { ...process.env },
            encoding: "utf-8",
            timeout: 30000,
        });
        console.log("[migrate] drizzle-kit push 완료:", output);
    } catch (err: unknown) {
        const error = err as { stdout?: string; stderr?: string; message?: string };
        console.error("[migrate] drizzle-kit push 에러:", error.stderr || error.message);
    }
}
