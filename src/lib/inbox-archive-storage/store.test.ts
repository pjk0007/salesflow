import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertArchiveSource, createArchiveStore, verifiedArchiveBytes, MAX_ARCHIVE_FILE_BYTES } from "./store";
import type { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
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
test("object writes are conditional and close the request stream on success and failure", async () => {
    let body: Readable | undefined;
    const client = { send: async (command: PutObjectCommand) => {
        assert.equal(command.input.IfNoneMatch, "*");
        assert.equal(Object.hasOwn(command.input, "ACL"), false);
        body = command.input.Body as Readable;
        const chunks = []; for await (const value of body) chunks.push(value);
        assert.deepEqual(Buffer.concat(chunks), bytes);
    } } as unknown as S3Client;
    await createArchiveStore(client, "fictional-private").put("fictional-key", source);
    assert.equal(body?.destroyed, true);
    const rejected = { send: async (command: PutObjectCommand) => { body = command.input.Body as Readable; throw Error("fictional precondition"); } } as unknown as S3Client;
    await assert.rejects(createArchiveStore(rejected, "fictional-private").put("fictional-key", source));
    assert.equal(body?.destroyed, true);
});
