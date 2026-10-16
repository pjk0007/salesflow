import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseArgs, run } = require("../../../scripts/migrate-private-archive-files.cjs") as { parseArgs: (args: string[]) => { execute: boolean; storage: { encryption?: { mode: string; keyFingerprint: string } } }; run: (options: unknown) => Promise<unknown> };
const args = ["--online", "--bundle", "private-source.json", "--archive-dir", "private-archive", "--out", "private-review", "--api-base", "https://sendb.example.test", "--workspace-id", "8", "--namespace", "fixture", "--channel-id", "fixture", "--storage-endpoint", "https://storage.example.test", "--storage-bucket", "fixture-private"];
test("operator CLI is review-only until an explicit execution SHA and rejects DB or unknown parameters", () => {
    assert.equal(parseArgs(args).execute, false);
    for (const extra of [["--execute"], ["--resume"], ["--approve-sha256", "a".repeat(64)], ["--database-url", "anything"], ["--online"]]) assert.throws(() => parseArgs([...args, ...extra]));
    assert.equal(parseArgs([...args, "--execute", "--approve-sha256", "a".repeat(64)]).execute, true);
});
test("API and storage origins never accept credentials, paths or non-loopback cleartext", () => {
    for (const option of ["--api-base", "--storage-endpoint"]) for (const value of ["https://secret@example.test", "https://example.test/path", "https://example.test/?token=secret", "http://example.test"]) {
        const changed = [...args]; changed[changed.indexOf(option) + 1] = value; assert.throws(() => parseArgs(changed));
    }
    assert.throws(() => parseArgs([...args, "--local-qa"]));
});
test("operator plan binds the encryption key fingerprint and rejects key changes before any network or source read", async () => {
    const mode = process.env.INBOX_ARCHIVE_STORAGE_MODE, previousKey = process.env.INBOX_ARCHIVE_SSE_C_KEY;
    try {
        process.env.INBOX_ARCHIVE_STORAGE_MODE = "encrypted_shared"; delete process.env.INBOX_ARCHIVE_SSE_C_KEY;
        assert.throws(() => parseArgs(args), /암호화/);
        process.env.INBOX_ARCHIVE_SSE_C_KEY = Buffer.alloc(32, 37).toString("base64");
        const options = parseArgs(args);
        assert.equal(options.storage.encryption?.mode, "encrypted_shared"); assert.match(options.storage.encryption!.keyFingerprint, /^[a-f0-9]{64}$/);
        assert.equal(JSON.stringify(options).includes(process.env.INBOX_ARCHIVE_SSE_C_KEY), false);
        process.env.INBOX_ARCHIVE_SSE_C_KEY = Buffer.alloc(32, 38).toString("base64");
        await assert.rejects(run(options), (e: unknown) => (e as { code: string }).code === "storage_encryption_changed");
    } finally {
        if (mode === undefined) delete process.env.INBOX_ARCHIVE_STORAGE_MODE; else process.env.INBOX_ARCHIVE_STORAGE_MODE = mode;
        if (previousKey === undefined) delete process.env.INBOX_ARCHIVE_SSE_C_KEY; else process.env.INBOX_ARCHIVE_SSE_C_KEY = previousKey;
    }
});
