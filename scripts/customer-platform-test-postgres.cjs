/* eslint-disable @typescript-eslint/no-require-imports -- 소유한 loopback PostgreSQL의 가상 DB 전용 검수 도우미 */
const fs = require("node:fs"),
    path = require("node:path"),
    { randomUUID } = require("node:crypto");
const { runPlatformCheck } = require("./check-customer-platform.cjs");
async function runPostgresPlatformCheck(scenario) {
    const postgres = require("postgres"),
        { drizzle } = require("drizzle-orm/postgres-js"),
        schema = require("../src/lib/db/schema.ts"),
        dataDir = path.resolve(__dirname, "../.testenv/pg-capacity-data");
    const server = fs
        .readFileSync(path.join(dataDir, "postmaster.pid"), "utf8")
        .trim()
        .split(/\r?\n/);
    if (path.resolve(server[1]) !== dataDir || server[3] !== "55439")
        throw new Error("준비한 로컬 시험 PostgreSQL 경로/포트와 다릅니다.");
    process.kill(Number(server[0]), 0);
    const admin = postgres("postgresql://sendb_qa@127.0.0.1:55439/postgres", {
            max: 1,
        }),
        name = "sendb_capacity_qa_" + randomUUID().replaceAll("-", "");
    if (!/^sendb_capacity_qa_[a-f0-9]{32}$/.test(name))
        throw new Error("가상 DB 이름 이탈");
    const [settings] =
        await admin`SELECT current_setting('data_directory') AS dir`;
    if (path.resolve(settings.dir) !== dataDir) {
        await admin.end();
        throw new Error("가상 PostgreSQL 데이터 경로 불일치");
    }
    await admin.unsafe("CREATE DATABASE " + name);
    const client = postgres("postgresql://sendb_qa@127.0.0.1:55439/" + name, {
        max: 8,
    });
    const runtime = {
        db: drizzle(client, { schema }),
        pg: {
            waitReady: Promise.resolve(),
            exec: (q) => client.unsafe(q),
            query: async (q, p = []) => ({ rows: await client.unsafe(q, p) }),
            close: () => client.end(),
        },
    };
    try {
        await runPlatformCheck(scenario, runtime);
    } finally {
        await client.end();
        await admin.unsafe("DROP DATABASE " + name);
        await admin.end();
    }
}
module.exports = { runPostgresPlatformCheck };
