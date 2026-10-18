import { test } from "node:test";
import assert from "node:assert/strict";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { artifactHash, createEsignStorage, s3EsignBlobStore, type EsignBlobStore } from "./storage";
function fixture() {
    const files = new Map<string, Uint8Array>();
    const raw: EsignBlobStore = { async putOnce(key, bytes) { if (files.has(key)) return false; files.set(key, bytes.slice()); return true; }, async read(key) { const bytes = files.get(key); if (!bytes) throw Error("missing"); return bytes; } };
    return { files, store: createEsignStorage(raw, "isolated-fake-test-secret-0000000000000000") };
}
test("계약 파일은 암호문으로만 저장하고 동일 내용 재실행은 원본을 보존한다", async () => {
    const { files, store } = fixture(), bytes = Buffer.from("fake private contract content");
    const ref = await store.put("esign/documents/fake/source.pdf", bytes, "application/pdf");
    const sealed = files.get(ref.key)!.slice();
    assert(!Buffer.from(sealed).includes(bytes));
    assert.deepEqual(Buffer.from(await store.get(ref)), bytes);
    assert.deepEqual(await store.put(ref.key, bytes, "application/pdf"), ref);
    assert.deepEqual(files.get(ref.key), sealed);
    await assert.rejects(store.put(ref.key, Buffer.from("different"), "application/pdf"), /덮어쓸/);
});
test("객체 이름을 바꾸거나 암호문/메타데이터를 변조하면 다운로드를 거부한다", async () => {
    const { files, store } = fixture(), ref = await store.put("esign/documents/fake/source.pdf", Buffer.from("fake"), "application/pdf");
    files.set("esign/documents/fake/other.pdf", files.get(ref.key)!);
    await assert.rejects(store.get({ ...ref, key: "esign/documents/fake/other.pdf" }), /무결성/);
    await assert.rejects(store.get({ ...ref, sha256: "0".repeat(64) }), /해시/);
    const tampered = files.get(ref.key)!.slice(); tampered[tampered.length - 1] ^= 1; files.set(ref.key, tampered);
    await assert.rejects(store.get(ref), /무결성/);
});
test("계약 경로 밖의 파일이나 빈 객체를 저장하지 않는다", async () => {
    const { store } = fixture();
    for (const key of ["../secret", "esign/../outside.pdf", "public/contract.pdf", "esign/a/../../file.pdf"])
        await assert.rejects(store.put(key, Buffer.from("fake"), "application/pdf"));
    await assert.rejects(store.put("esign/documents/fake/empty.pdf", new Uint8Array(), "application/pdf"));
});

function providerWithoutConditionalPut() {
    const files = new Map<string, Buffer>();
    let puts = 0;
    const client = { async send(command: PutObjectCommand | GetObjectCommand) {
        const key = command.input.Key!;
        if (command instanceof PutObjectCommand) {
            puts++;
            if (command.input.IfNoneMatch) throw Object.assign(new Error("Conditional object PUTs are not supported."), { $metadata: { httpStatusCode: 501 } });
            files.set(key, Buffer.from(command.input.Body as Uint8Array));
            return {};
        }
        const bytes = files.get(key);
        if (!bytes) throw new Error("missing");
        return { ContentLength: bytes.length, Body: (async function* () { yield bytes; })() };
    } } as unknown as S3Client;
    return { files, client, puts: () => puts };
}

test("조건부 쓰기를 지원하지 않는 공급자도 서로 다른 암호문 버전과 동시 요청을 보존한다", async () => {
    const provider = providerWithoutConditionalPut();
    const raw = s3EsignBlobStore(provider.client, "isolated-contracts", "content-addressed");
    const store = createEsignStorage(raw, "isolated-fake-test-secret-0000000000000000");
    const key = "esign/signatures/fake-envelope/fake-recipient/input.png";
    const first = Buffer.from("fake first private signature"), second = Buffer.from("fake second private signature");
    const [a, b, retry] = await Promise.all([store.put(key, first, "image/png"), store.put(key, second, "image/png"), store.put(key, first, "image/png")]);
    assert.equal(new Set([a.key, b.key, retry.key]).size, 3);
    for (const ref of [a, b, retry]) {
        assert(ref.key.startsWith(key + ".sbe1-"));
        assert.equal(ref.key.split(".sbe1-")[1], artifactHash(provider.files.get(ref.key)!));
        assert(!provider.files.get(ref.key)!.includes(first));
    }
    assert.deepEqual(Buffer.from(await store.get(a)), first);
    assert.deepEqual(Buffer.from(await store.get(b)), second);
    assert.deepEqual(Buffer.from(await store.get(retry)), first);
    const writes = provider.puts();
    await assert.rejects(raw.putOnce(a.key, Buffer.from("replacement")), /경로와 내용/);
    assert.equal(provider.puts(), writes, "다른 내용은 공급자를 호출하기 전에 거부한다");
    assert.deepEqual(Buffer.from(await store.get(a)), first);
    const renamed = a.key.replace("input.png", "other.png");
    provider.files.set(renamed, provider.files.get(a.key)!);
    await assert.rejects(store.get({ ...a, key: renamed }), /무결성/);
});

test("기존 조건부 저장소는 지원하지 않는 공급자의 실패를 덮어쓰기 재시도로 바꾸지 않는다", async () => {
    const provider = providerWithoutConditionalPut();
    const store = createEsignStorage(s3EsignBlobStore(provider.client, "isolated-contracts"), "isolated-fake-test-secret-0000000000000000");
    await assert.rejects(store.put("esign/documents/fake/source.pdf", Buffer.from("fake"), "application/pdf"), /Conditional object PUTs/);
    assert.equal(provider.puts(), 1);
    assert.equal(provider.files.size, 0);
});
