/* eslint-disable @typescript-eslint/no-require-imports -- Build artifact verification uses Node APIs. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function validateJournal(journal) {
    if (!Array.isArray(journal.entries) || !journal.entries.length)
        throw new Error("마이그레이션 목록이 비어 있습니다.");
    const tags = new Set();
    let previous = -1;
    for (const [index, entry] of journal.entries.entries()) {
        if (entry.idx !== index || !Number.isSafeInteger(entry.when) || entry.when <= previous ||
            typeof entry.tag !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || tags.has(entry.tag))
            throw new Error("마이그레이션 번호·시각·이름 충돌: " + index);
        tags.add(entry.tag);
        previous = entry.when;
    }
}

function copyRuntimeMigrations(root = process.cwd()) {
    const source = path.join(root, "drizzle");
    const standalone = path.join(root, ".next", "standalone");
    const destination = path.join(standalone, "drizzle");
    if (!fs.existsSync(path.join(standalone, "server.js")))
        throw new Error("standalone 서버 빌드를 먼저 완료해주세요.");
    const journal = JSON.parse(fs.readFileSync(path.join(source, "meta", "_journal.json"), "utf8"));
    validateJournal(journal);
    // Next standalone excludes these unless they are copied for self-hosting.
    for (const relative of [".next/static", "public"]) {
        const assetDirectory = path.join(root, relative);
        if (fs.existsSync(assetDirectory))
            fs.cpSync(assetDirectory, path.join(standalone, relative), { recursive: true });
    }
    fs.cpSync(source, destination, { recursive: true });
    const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const journal = JSON.parse(fs.readFileSync(path.join(source, "meta", "_journal.json"), "utf8"));
    for (const relative of ["meta/_journal.json", "esign/0001.sql", ...journal.entries.map((entry) => entry.tag + ".sql")]) {
        if (digest(path.join(source, relative)) !== digest(path.join(destination, relative)))
            throw new Error("배포 마이그레이션 파일 검증 실패: " + relative);
    }
    const workerSource = path.join(root, ".esign-runtime", "pdf-worker.cjs");
    if (!fs.existsSync(workerSource)) throw new Error("전자서명 PDF worker 빌드가 필요합니다.");
    const workerDestination = path.join(standalone, ".esign-runtime", "pdf-worker.cjs");
    fs.mkdirSync(path.dirname(workerDestination), { recursive: true });
    fs.copyFileSync(workerSource, workerDestination);
    if (digest(workerSource) !== digest(workerDestination)) throw new Error("전자서명 PDF worker 배포 파일 검증 실패");
    const workerNotices = path.join(root, ".esign-runtime", "pdf-worker-LICENSES.txt");
    const deployedNotices = path.join(standalone, ".esign-runtime", "pdf-worker-LICENSES.txt");
    fs.copyFileSync(workerNotices, deployedNotices);
    if (digest(workerNotices) !== digest(deployedNotices)) throw new Error("전자서명 PDF 라이선스 배포 파일 검증 실패");
    const assetSource = path.join(root, ".esign-runtime", "pdfjs-assets");
    if (!fs.existsSync(assetSource)) throw new Error("전자서명 PDF 표시 자료 빌드가 필요합니다.");
    const assetDestination = path.join(standalone, ".esign-runtime", "pdfjs-assets");
    fs.cpSync(assetSource, assetDestination, { recursive: true });
    function verifyAssets(directory, relative = "") {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(relative, entry.name);
            if (entry.isDirectory()) verifyAssets(path.join(directory, entry.name), file);
            else if (digest(path.join(assetSource, file)) !== digest(path.join(assetDestination, file)))
                throw new Error("전자서명 PDF 표시 자료 배포 파일 검증 실패");
        }
    }
    verifyAssets(assetSource);
    return { migrations: journal.entries.length, journalSha256: digest(path.join(destination, "meta", "_journal.json")) };
}

if (require.main === module)
    console.log("[build-runtime-migrations] " + JSON.stringify(copyRuntimeMigrations()));
module.exports = { copyRuntimeMigrations, validateJournal };
