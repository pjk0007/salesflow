/* eslint-disable @typescript-eslint/no-require-imports -- Build artifact verification uses Node APIs. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function copyRuntimeMigrations(root = process.cwd()) {
    const source = path.join(root, "drizzle");
    const standalone = path.join(root, ".next", "standalone");
    const destination = path.join(standalone, "drizzle");
    if (!fs.existsSync(path.join(standalone, "server.js")))
        throw new Error("standalone 서버 빌드를 먼저 완료해주세요.");
    fs.cpSync(source, destination, { recursive: true });
    const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const journal = JSON.parse(fs.readFileSync(path.join(source, "meta", "_journal.json"), "utf8"));
    for (const relative of ["meta/_journal.json", ...journal.entries.map((entry) => entry.tag + ".sql")]) {
        if (digest(path.join(source, relative)) !== digest(path.join(destination, relative)))
            throw new Error("배포 마이그레이션 파일 검증 실패: " + relative);
    }
    return { migrations: journal.entries.length, journalSha256: digest(path.join(destination, "meta", "_journal.json")) };
}

if (require.main === module)
    console.log("[build-runtime-migrations] " + JSON.stringify(copyRuntimeMigrations()));
module.exports = { copyRuntimeMigrations };
