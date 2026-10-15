import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir, hostname } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { splitChannelBundle, type ChannelChunkBundle } from "./chunks";
import { channelOutputIdentity, ChannelOutputError, openChannelOutput } from "./output";
import { exportChannelData } from "@/lib/customer-imports/channel-export";
import { createChannelCollectorRequest } from "./collector-request";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const identity = channelOutputIdentity({ channelId: "fictional", namespace: "fictional-export", workspaceId: 8 });
const bundle = (): ChannelChunkBundle => ({ users: [{ id: "u", profile: { name: "허구" } }], managers: [], bots: [], userChats: [{ id: "c", userId: "u", state: "opened" }], messages: [{ id: "m", chatId: "c", personType: "user", personId: "u", plainText: "허구", createdAt: 1704067200000 }], hasNext: false });
const result = (raw = bundle(), phase: "complete" | "incomplete" = "complete") => {
    raw.hasNext = phase !== "complete";
    return { status: phase, bundle: raw, checkpoint: { schemaVersion: 1, apiVersion: identity.apiVersion, channelId: identity.channelId, pageSize: identity.pageSize, requestCount: 1, status: phase, bundle: raw, ledger: {} }, counts: { users: raw.users.length, messages: raw.messages.length }, limitations: ["허구 선택 endpoint 범위"] };
};
const parse = async (file: string) => JSON.parse(await fs.readFile(file, "utf8"));
const code = (expected: string) => (error: unknown) => error instanceof ChannelOutputError && error.code === expected;
async function temporary(run: (root: string) => Promise<void>) {
    const root = await fs.mkdtemp(path.join(tmpdir(), "sendb-channel-export-"));
    try { await run(root); }
    finally {
        assert.equal(path.dirname(root), await fs.realpath(tmpdir()));
        assert.ok(path.basename(root).startsWith("sendb-channel-export-"));
        await fs.rm(root, { recursive: true, force: true });
    }
}

test("완성 원본·실제 importer chunk·manifest를 원자 저장하고 같은 identity로 재개", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity), exported = result();
    const plan = splitChannelBundle(exported.bundle, identity);
    await output.writeCheckpoint(exported.checkpoint);
    const manifest = await output.publish(exported, plan);
    assert.equal(manifest.importReady, true); assert.equal(manifest.migrationApplied, false);
    assert.deepEqual(await parse(path.join(output.directory, manifest.raw.path)), exported.bundle);
    for (const chunk of manifest.chunks!) assert.equal(digest(await fs.readFile(path.join(output.directory, chunk.path))), chunk.sha256);
    await output.close();
    const resumed = await openChannelOutput(output.directory, identity, { resume: true });
    assert.deepEqual(resumed.checkpoint, exported.checkpoint);
    await resumed.publish(exported, plan); await resumed.close();
    assert.ok(!(await fs.readdir(output.directory)).some(name => name.startsWith(".tmp-") || name === ".export.lock"));
}));

test("미완료·chunk 거절·빈 원본도 raw를 남기며 가져오기 준비 완료를 주장하지 않음", async () => temporary(async root => {
    for (const [label, exported, plan, issue] of [
        ["partial", result(bundle(), "incomplete"), undefined, undefined],
        ["blocked", result(), undefined, { code: "missing_dependency" }],
        ["empty", result({ users: [], managers: [], bots: [], userChats: [], messages: [], hasNext: false }), splitChannelBundle({ users: [], managers: [], bots: [], userChats: [], messages: [], hasNext: false }, identity), undefined],
    ] as const) {
        const output = await openChannelOutput(path.join(root, label), identity);
        const manifest = await output.publish(exported, plan, undefined, issue);
        assert.equal(manifest.importReady, false);
        assert.ok(await fs.stat(path.join(output.directory, manifest.raw.path)));
        assert.equal(manifest.files.status, "needs_source");
        if (label === "empty") assert.equal(manifest.importStatus, "no-import-data");
        await output.close();
    }
}));

test("경로 충돌·동시 실행·identity 및 checkpoint version/hash 불일치를 거절", async () => temporary(async root => {
    const unrelated = path.join(root, "unrelated"); await fs.mkdir(unrelated); await fs.writeFile(path.join(unrelated, "keep.txt"), "keep");
    await assert.rejects(openChannelOutput(unrelated, identity), code("collision"));
    const output = await openChannelOutput(path.join(root, "out"), identity);
    await assert.rejects(openChannelOutput(output.directory, identity, { resume: true, recoverStaleLock: true }), code("locked"));
    await output.writeCheckpoint(result().checkpoint); await output.close();
    for (const change of [{ channelId: "other" }, { namespace: "other" }, { pageSize: 2 }, { workspaceId: 9 }, { formatVersion: 2 }])
        await assert.rejects(openChannelOutput(output.directory, { ...identity, ...change } as typeof identity, { resume: true }), code("identity"));
    const file = path.join(output.directory, "checkpoint.json"), original = await parse(file);
    for (const broken of [{ ...original, formatVersion: 2 }, { ...original, sha256: "0".repeat(64) }]) {
        await fs.writeFile(file, JSON.stringify(broken));
        await assert.rejects(openChannelOutput(output.directory, identity, { resume: true }), code("checkpoint"));
    }
    await fs.writeFile(file, JSON.stringify(original));
    const resumed = await openChannelOutput(output.directory, identity, { resume: true }); await resumed.close();
    assert.equal(await fs.readFile(path.join(unrelated, "keep.txt"), "utf8"), "keep");
}));

test("immutable chunk와 기존 metadata의 충돌을 조용히 덮어쓰지 않음", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity), exported = result(), plan = splitChannelBundle(exported.bundle, identity);
    await output.publish(exported, plan);
    await fs.writeFile(path.join(output.directory, "chunks", plan.chunks[0].fileName), "changed");
    await assert.rejects(output.publish(exported, plan), code("collision"));
    await fs.writeFile(path.join(output.directory, "manifest.json"), JSON.stringify({ unrelated: true }));
    await assert.rejects(output.fail("fixture"), code("collision")); await output.close();
}));

test("full raw response의 sidecar·범위 metadata를 보존하고 변경된 같은 페이지는 새 version으로 보존", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity);
    const page = { path: "/open/user-chats", query: { state: "opened", limit: 100 }, apiVersion: identity.apiVersion, status: 200, body: { userChats: [], sessions: [{ id: "fictional-session" }], chatTags: [{ id: "fictional-tag" }], range: { complete: true } } };
    const first = await output.saveSourcePage({ ...page, headers: { "X-Access-Key": "never-save" } } as typeof page);
    assert.equal((await output.saveSourcePage(page)).changed, false);
    const second = await output.saveSourcePage({ ...page, body: { ...page.body, range: { complete: false } } });
    assert.equal(second.changed, true); assert.notEqual(first.path, second.path);
    const archived = await parse(path.join(output.directory, first.path));
    assert.deepEqual(archived.body, page.body); assert.equal(archived.headers, undefined);
    const manifest = await output.publish(result(), splitChannelBundle(bundle(), identity));
    assert.equal(manifest.pages.scopes, 1); assert.equal(manifest.pages.versions, 2); assert.equal(manifest.pages.changedScopes, 1);
    await assert.rejects(output.saveSourcePage({ ...page, path: "/open/user-chats/c/messages/file" }), code("checkpoint"));
    await assert.rejects(output.saveSourcePage({ ...page, query: { key: "never-save" } }), code("checkpoint"));
    await output.close();
    const resumed = await openChannelOutput(output.directory, identity, { resume: true }); await resumed.close();
    await fs.writeFile(path.join(output.directory, first.path), "tampered");
    await assert.rejects(openChannelOutput(output.directory, identity, { resume: true }), code("checkpoint"));
}));

test("동시 raw page callback을 호출 순서대로 저장하고 close 후 늦은 쓰기를 거절", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity);
    const calls = Array.from({ length: 25 }, (_, index) => output.saveSourcePage({ path: "/open/user-chats", query: { cursor: String(index) }, apiVersion: identity.apiVersion, status: 200, body: { data: "가".repeat(4000), index } }));
    const closing = output.close();
    await assert.rejects(output.writeCheckpoint(result().checkpoint), code("closed"));
    await Promise.all(calls); await closing;
    const index = await parse(path.join(output.directory, "pages-index.json"));
    assert.equal(index.payload.length, 25);
    assert.deepEqual(index.payload.map((row: { query: { cursor: string } }) => row.query.cursor), Array.from({ length: 25 }, (_, i) => String(i)));
}));

test("commit된 cursor의 full raw page 증거가 없거나 재개 중 사라지면 거절", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity), exported = result();
    const checkpoint = { ...exported.checkpoint, ledger: { channel: { path: "/open/channel", query: {}, status: "complete", cursor: null, seenCursors: [null], pages: 1 } } };
    await assert.rejects(output.writeCheckpoint(checkpoint), code("checkpoint"));
    await output.saveSourcePage({ path: "/open/channel", query: {}, apiVersion: identity.apiVersion, status: 200, body: { channel: { id: identity.channelId } } });
    await output.writeCheckpoint(checkpoint); await output.close();
    const indexPath = path.join(output.directory, "pages-index.json"), index = await fs.readFile(indexPath, "utf8");
    await fs.unlink(indexPath);
    await assert.rejects(openChannelOutput(output.directory, identity, { resume: true }), code("checkpoint"));
    await fs.writeFile(indexPath, index);
    const resumed = await openChannelOutput(output.directory, identity, { resume: true }); await resumed.close();
}));

test("실제 collector deadline 후 늦은 archive callback은 닫힌 output을 변경하지 않음", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity);
    let delayed: Promise<unknown> | undefined, release = () => {}, first = true;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const request = createChannelCollectorRequest(async input => ({ status: 200, headers: {}, body: input.path === "/open/channel" ? { channel: { id: identity.channelId } } : { [input.path === "/open/managers" ? "managers" : "userChats"]: [], hasNext: false, nextCursor: null } }), {
        expectedChannelId: identity.channelId,
        savePage: page => {
            if (first) { first = false; delayed = gate.then(() => output.saveSourcePage(page)); return delayed; }
            return output.saveSourcePage(page);
        },
    });
    const exported = await exportChannelData({ channelId: identity.channelId, request, sleep: async () => {}, limits: { timeoutMs: 40, minRequestIntervalMs: 0, retryBaseMs: 0 } });
    assert.equal(exported.status, "complete");
    await output.publish(exported, splitChannelBundle(exported.bundle, identity)); await output.close();
    const before = await fs.readFile(path.join(output.directory, "pages-index.json"), "utf8"); release();
    // The wrapper converts a rejected late write to a safe archive error.
    await assert.rejects(delayed!);
    assert.equal(await fs.readFile(path.join(output.directory, "pages-index.json"), "utf8"), before);
}));

test("파일 bytes는 내용 hash로 저장·검증하고 손상·경로 우회·잘못된 receipt를 거절", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity), bytes = Buffer.from("fictional bytes"), sha256 = digest(bytes);
    const meta = { id: digest("fictional asset"), sha256, size: bytes.length };
    const receipt = await output.saveBytes(bytes, meta);
    assert.deepEqual(await output.saveBytes(bytes, meta), receipt); assert.equal(await output.verifyBytes(receipt), true);
    assert.equal(await output.verifyBytes({ ...receipt, path: "../outside.bin" }), false);
    await assert.rejects(output.saveBytes(bytes, { ...meta, size: 1 }), code("bytes"));
    await fs.writeFile(path.join(output.directory, receipt.path), "corrupt");
    assert.equal(await output.verifyBytes(receipt), false);
    await assert.rejects(output.saveBytes(bytes, meta), code("collision")); await output.close();
}));

test("명시한 재개에서 종료된 프로세스 lock만 복구", async () => temporary(async root => {
    const output = await openChannelOutput(path.join(root, "out"), identity); await output.close();
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]); assert.equal(dead.status, 0); assert.ok(dead.pid > 0);
    await fs.writeFile(path.join(output.directory, ".export.lock"), JSON.stringify({ formatVersion: 1, identity, nonce: "fictional-dead-lock", host: hostname(), pid: dead.pid }));
    await assert.rejects(openChannelOutput(output.directory, identity, { resume: true }), code("locked"));
    const resumed = await openChannelOutput(output.directory, identity, { resume: true, recoverStaleLock: true }); await resumed.close();
    assert.ok((await fs.readdir(output.directory)).some(name => name.startsWith(".stale-lock-")));
}));

test("symlink output·bytes 디렉터리를 따라 쓰지 않음", async () => temporary(async root => {
    const real = path.join(root, "real"); await fs.mkdir(real);
    const linked = path.join(root, "linked"); await fs.symlink(real, linked, "junction");
    await assert.rejects(openChannelOutput(linked, identity), code("path"));
    const output = await openChannelOutput(path.join(root, "out"), identity);
    await fs.symlink(real, path.join(output.directory, "bytes"), "junction");
    const bytes = Buffer.from("x");
    await assert.rejects(output.saveBytes(bytes, { id: digest("id"), sha256: digest(bytes), size: 1 }), code("path"));
    assert.deepEqual(await fs.readdir(real), []); await output.close();
}));
