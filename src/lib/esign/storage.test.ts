import { test } from "node:test";
import assert from "node:assert/strict";
import { createEsignStorage, type EsignBlobStore } from "./storage";
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
