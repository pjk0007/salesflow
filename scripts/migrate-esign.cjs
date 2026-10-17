/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
async function main() {
    const url = process.env.ESIGN_DATABASE_URL;
    if (!url) throw new Error("ESIGN_DATABASE_URL을 명시적으로 설정해주세요. 기존 DB URL을 자동 사용하지 않습니다.");
    const sql = postgres(url, { max: 1, onnotice: () => undefined });
    try {
        const migration = fs.readFileSync(path.join(__dirname, "../drizzle/esign/0001.sql"), "utf8");
        if (/\bDROP\b/i.test(migration)) throw new Error("전자서명 초기 마이그레이션 범위를 확인해주세요.");
        await sql.begin(async tx => { await tx.unsafe(migration); });
        console.log("전자서명 전용 메타데이터 스키마 준비 완료");
    } finally { await sql.end({ timeout: 5 }); }
}
main().catch(() => { console.error("전자서명 마이그레이션에 실패했습니다. 대상과 설정을 확인해주세요."); process.exitCode = 1; });
