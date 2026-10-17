import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { archiveEncryptionBinding, archiveEncryptionFromEnv, assertArchiveSource, createArchiveStore, verifiedArchiveBytes, MAX_ARCHIVE_FILE_BYTES, type ArchiveSource } from "./store";
import type { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
const bytes = Buffer.from("fictional private archive");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = { size: bytes.length, sha256, open: async function*() { yield bytes.subarray(0, 5); yield bytes.subarray(5); } };
async function consume(value: ArchiveSource) { const chunks = []; for await (const c of verifiedArchiveBytes(value)) chunks.push(c); return Buffer.concat(chunks); }
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
const encryption = { mode: "encrypted_shared" as const, keyBase64: Buffer.alloc(32, 73).toString("base64") };
test("shared storage never falls back to plaintext when encryption settings are missing or malformed", () => {
    assert.deepEqual(archiveEncryptionFromEnv({}), { mode: "private" });
    for (const env of [
        { INBOX_ARCHIVE_STORAGE_MODE: "encrypted_shared" },
        { INBOX_ARCHIVE_SSE_C_KEY: encryption.keyBase64 },
        { INBOX_ARCHIVE_STORAGE_MODE: "unknown" },
        ...["", " ".repeat(44), Buffer.alloc(31).toString("base64"), encryption.keyBase64.slice(0, -1), encryption.keyBase64.slice(0, -2) + "B="].map(INBOX_ARCHIVE_SSE_C_KEY => ({ INBOX_ARCHIVE_STORAGE_MODE: "encrypted_shared", INBOX_ARCHIVE_SSE_C_KEY })),
    ]) assert.throws(() => archiveEncryptionFromEnv(env), /암호화/);
    assert.deepEqual(archiveEncryptionFromEnv({ INBOX_ARCHIVE_STORAGE_MODE: encryption.mode, INBOX_ARCHIVE_SSE_C_KEY: encryption.keyBase64 }), encryption);
    const binding = archiveEncryptionBinding(encryption);
    assert.equal(binding?.keyFingerprint, createHash("sha256").update(Buffer.alloc(32, 73)).digest("hex"));
    assert.equal(JSON.stringify(binding).includes(encryption.keyBase64), false);
    assert.equal(archiveEncryptionBinding({ mode: "private" }), undefined);
});
test("encrypted PUT and GET both require matching provider encryption response and keep keys out of metadata", async () => {
    let writes = 0, reads = 0;
    const client = { send: async (command: PutObjectCommand | GetObjectCommand) => {
        assert.equal(command.input.SSECustomerAlgorithm, "AES256");
        assert.equal(command.input.SSECustomerKey, encryption.keyBase64);
        assert.equal(command.input.SSECustomerKeyMD5, createHash("md5").update(Buffer.alloc(32, 73)).digest("base64"));
        const response = { SSECustomerAlgorithm: command.input.SSECustomerAlgorithm, SSECustomerKeyMD5: command.input.SSECustomerKeyMD5 };
        if ("Body" in command.input) {
            writes++; assert.equal(command.input.CacheControl, "no-store"); assert.equal(command.input.IfNoneMatch, "*");
            assert.equal(Object.hasOwn(command.input, "Metadata"), false); assert.equal(Object.hasOwn(command.input, "ACL"), false);
            const actual = []; for await (const c of command.input.Body as Readable) actual.push(c); assert.deepEqual(Buffer.concat(actual), bytes);
            return response;
        }
        reads++; return { ...response, ContentLength: bytes.length, Body: Readable.from([bytes]) };
    } } as unknown as S3Client;
    const store = createArchiveStore(client, "fictional-shared", encryption);
    await store.put("fictional-key", source);
    const result = await store.get("fictional-key"); assert.deepEqual(await consume({ ...source, open: () => result.body }), bytes);
    assert.equal(writes, 1); assert.equal(reads, 1);
});
test("encryption response mismatch aborts writes and closes rejected read streams", async () => {
    let body: Readable | undefined;
    const client = { send: async (command: PutObjectCommand | GetObjectCommand) => {
        if ("Body" in command.input) { body = command.input.Body as Readable; for await (const c of body) void c; return {}; }
        body = Readable.from([bytes]); return { SSECustomerAlgorithm: "AES256", SSECustomerKeyMD5: "wrong", Body: body, ContentLength: bytes.length };
    } } as unknown as S3Client;
    const store = createArchiveStore(client, "fictional-shared", encryption);
    await assert.rejects(store.put("fictional-key", source), /암호화 응답/); assert.equal(body?.destroyed, true);
    await assert.rejects(store.get("fictional-key"), /암호화 응답/); assert.equal(body?.destroyed, true);
});
