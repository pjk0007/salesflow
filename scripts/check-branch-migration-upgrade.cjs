/* eslint-disable @typescript-eslint/no-require-imports -- 고정 Git 기준과 소유한 loopback PostgreSQL만 사용 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const postgres = require("postgres");
const { drizzle } = require("drizzle-orm/postgres-js");
const { migrate } = require("drizzle-orm/postgres-js/migrator");
const root = path.resolve(__dirname, "..");
const baselines = {
    main: "09311524c17b5145ef8284cd7e0612d705fe4d04",
    dev: "090077e6541462aaad0feddadcab2b6d3cb9c97f", // 실제 개발 DB 덤프의 0113까지 적용한 분기
    devWithArchive: "4656e376630c039b8bfc61d65344d4f6f3b0434f", // 비공개 첨부 0114까지 검수한 분기
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const plain = value => JSON.parse(JSON.stringify(value));
const runId = randomUUID().replaceAll("-", "");
const folder = path.join(root, ".testenv", "branch-upgrade-" + runId);

async function snapshot(client) {
    const rows = await client`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const result = {};
    for (const { tablename } of rows) {
        assert.match(tablename, /^[a-z_0-9]+$/);
        const expression = tablename === 'email_template_links' ? "(to_jsonb(t) - 'sender_profile_id' - 'sender_profile_ids')" : "to_jsonb(t)";
        const [row] = await client.unsafe(`SELECT count(*)::text AS count, md5(coalesce(string_agg(digest, '' ORDER BY digest),'')) AS digest FROM (SELECT md5(${expression}::text) AS digest FROM "${tablename}" t) s`);
        result[tablename] = row;
    }
    return result;
}

async function main() {
    const dataDir = fs.realpathSync(path.join(root, ".testenv", "pg-capacity-data"));
    const pid = fs.readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").trim().split(/\r?\n/);
    assert.equal(fs.realpathSync(pid[1]), dataDir);
    assert.equal(pid[3], "55439");
    process.kill(Number(pid[0]), 0);
    const admin = postgres("postgresql://sendb_qa@127.0.0.1:55439/postgres", { max: 1, onnotice: () => {} });
    try {
        const [settings] = await admin`SELECT current_setting('data_directory') AS dir`;
        assert.equal(fs.realpathSync(settings.dir), dataDir);
        fs.mkdirSync(folder, { recursive: true });
        const current = JSON.parse(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
        const reports = [];
        for (const [label, inputRef] of Object.entries(baselines)) {
            const ref = git("rev-parse", "--verify", inputRef + "^{commit}").trim();
            assert.match(ref, /^[a-f0-9]{40}$/);
            const source = JSON.parse(git("show", ref + ":drizzle/meta/_journal.json"));
            assert.equal(source.entries[88].tag, label === "main" ? "0088_template_link_sender_pool" : "0088_customer_inbox");
            const sourceDir = path.join(folder, label);
            fs.mkdirSync(path.join(sourceDir, "meta"), { recursive: true });
            fs.writeFileSync(path.join(sourceDir, "meta/_journal.json"), JSON.stringify(source));
            for (const entry of source.entries) {
                const original = git("show", ref + ":drizzle/" + entry.tag + ".sql");
                fs.writeFileSync(path.join(sourceDir, entry.tag + ".sql"), original);
                const preserved = fs.readFileSync(path.join(root, "drizzle", entry.tag + ".sql"), "utf8");
                assert.equal(sha(preserved.replaceAll("\r\n", "\n")), sha(original.replaceAll("\r\n", "\n")), "이미 적용한 SQL 변경: " + entry.tag);
            }
            const name = "sendb_branch_qa_" + randomUUID().replaceAll("-", "");
            assert.match(name, /^sendb_branch_qa_[a-f0-9]{32}$/);
            await admin.unsafe("CREATE DATABASE " + name);
            const url = "postgresql://sendb_qa@127.0.0.1:55439/" + name;
            const client = postgres(url, { max: 1, onnotice: () => {} });
            try {
                await migrate(drizzle(client), { migrationsFolder: sourceDir });
                const [org] = await client`INSERT INTO organizations(name,slug) VALUES ('가상 조직','migration-fixture') RETURNING id`;
                const [workspace] = await client`INSERT INTO workspaces(org_id,name) VALUES (${org.id},'가상 사업') RETURNING id`;
                const [partition] = await client`INSERT INTO partitions(workspace_id,name) VALUES (${workspace.id},'가상 명단') RETURNING id`;
                await client`INSERT INTO records(org_id,workspace_id,partition_id,data) VALUES (${org.id},${workspace.id},${partition.id},'{}')`;
                const [template] = await client`INSERT INTO email_templates(org_id,name,subject,html_body) VALUES (${org.id},'가상 템플릿','가상 제목','가상 본문') RETURNING id`;
                const [link] = await client`INSERT INTO email_template_links(partition_id,name,email_template_id,recipient_field) VALUES (${partition.id},'가상 연결',${template.id},'email') RETURNING id`;
                if (label === 'main') await client`UPDATE email_template_links SET sender_profile_id=71,sender_profile_ids='[71,72]'::jsonb WHERE id=${link.id}`;
                const before = await snapshot(client);
                const oldLedger = plain(await client`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
                const previousUrl = process.env.DATABASE_URL;
                process.env.DATABASE_URL = url;
                try {
                    assert.equal(await require("../src/lib/db/migrate.ts").runMigrations(), true);
                } finally {
                    if (previousUrl === undefined) delete process.env.DATABASE_URL;
                    else process.env.DATABASE_URL = previousUrl;
                }
                const [shape] = await client`SELECT to_regclass('inbox_channels') IS NOT NULL AS inbox, to_regclass('crm_contacts') IS NOT NULL AS crm`;
                assert.deepEqual(shape, { inbox: true, crm: true });
                const columns = await client`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='email_template_links' AND column_name IN ('sender_profile_id','sender_profile_ids') ORDER BY column_name`;
                assert.equal(columns.length, 2);
                const [pool] = await client`SELECT sender_profile_id,sender_profile_ids FROM email_template_links WHERE id=${link.id}`;
                assert.deepEqual(pool, label === 'main' ? {sender_profile_id:71,sender_profile_ids:[71,72]} : {sender_profile_id:null,sender_profile_ids:null});
                const after = await snapshot(client);
                for (const [table, digest] of Object.entries(before)) assert.deepEqual(after[table], digest, "기존 데이터 변경: " + table);
                const ledger = plain(await client`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`);
                assert.deepEqual(ledger.slice(0, oldLedger.length), oldLedger, "기존 DB 기록 재작성");
                await migrate(drizzle(client), { migrationsFolder: path.join(root, "drizzle") });
                assert.deepEqual(await snapshot(client), after);
                assert.deepEqual(plain(await client`SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id`), ledger);
                reports.push({ baseline: label, ref, oldMigrations: source.entries.length, appliedMigrations: ledger.length - oldLedger.length, existingTablesPreserved: Object.keys(before).length, sourceSqlUnchanged: true, oldLedgerUnchanged: true, retryNoChanges: true });
            } finally {
                await client.end();
                await admin.unsafe("DROP DATABASE " + name);
            }
        }
        const result = { status: "passed", migrationCount: current.entries.length, journalSha256: sha(fs.readFileSync(path.join(root, "drizzle/meta/_journal.json"))), productionChanged: false, reports };
        fs.writeFileSync(path.join(folder, "result.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result));
    } finally { await admin.end(); }
}
if (require.main === module) main().catch(error => { console.error(String(error.message).slice(0, 250)); process.exitCode = 1; });
