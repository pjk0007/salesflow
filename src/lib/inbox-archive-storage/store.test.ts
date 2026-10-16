import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertArchiveSource, verifiedArchiveBytes, MAX_ARCHIVE_FILE_BYTES } from "./store";
const bytes = Buffer.from("fictional private archive");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = { size: bytes.length, sha256, open: async function*() { yield bytes.subarray(0, 5); yield bytes.subarray(5); } };
async function consume(value: typeof source) { const chunks = []; for await (const c of verifiedArchiveBytes(value)) chunks.push(c); return Buffer.concat(chunks); }
test("streaming archive checks size and hash across chunks", async () => {
    assert.deepEqual(await consume(source), bytes);
    await assert.rejects(consume({ ...source, size: bytes.length - 1 }), /크기/);
    await assert.rejects(consume({ ...source, size: bytes.length + 1 }), /크기/);
    await assert.rejects(consume({ ...source, sha256: "0".repeat(64) }), /SHA-256/);
});
test("archive cap and hash validation cannot be bypassed", () => {
    for (const size of [0, -1, 1.5, NaN, Infinity, MAX_ARCHIVE_FILE_BYTES + 1])
        assert.throws(() => assertArchiveSource({ ...source, size }));
    for (const value of ["", "x".repeat(64), "A".repeat(64)])
        assert.throws(() => assertArchiveSource({ ...source, sha256: value }));
});
