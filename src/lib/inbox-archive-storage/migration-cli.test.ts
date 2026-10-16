import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseArgs } = require("../../../scripts/migrate-private-archive-files.cjs") as { parseArgs: (args: string[]) => { execute: boolean } };
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
