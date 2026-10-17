import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEsignAssetReader } from "./assets";
import { EsignError } from "./types";
import { handleEsignRequest, type EsignHttpDependencies } from "./http";

test("versioned renderer resources serve only allowlisted static library files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sendb-esign-assets-"));
    try {
        await mkdir(path.join(root, "6.4.299", "cmaps"), { recursive: true });
        await writeFile(path.join(root, "6.4.299", "cmaps", "UniKS-UCS2-H.bcmap"), "fake-static-map");
        const read = createEsignAssetReader(root), response = await read("6.4.299", "cmaps", "UniKS-UCS2-H.bcmap");
        assert.equal(await response.text(), "fake-static-map"); assert.match(response.headers.get("cache-control")!, /immutable/);
        for (const args of [["..", "cmaps", "UniKS-UCS2-H.bcmap"], ["6.4.299", "documents", "contract.pdf"], ["6.4.299", "cmaps", "../secret.bcmap"], ["6.4.299", "cmaps", "wrong.js"], ["6.4.299", "cmaps", "missing.bcmap"]])
            await assert.rejects(read(...args as [string, string, string]), (error: unknown) => error instanceof EsignError && error.status === 404);
    } finally {
        const resolved = path.resolve(root);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("sendb-esign-assets-"));
        await rm(resolved, { recursive: true, force: true });
    }
});
test("static renderer resources do not initialize contract services or metadata connections", async () => {
    let initialized = false;
    const dependencies = { async engine() { initialized = true; throw new Error("must not initialize"); } } as unknown as EsignHttpDependencies;
    const response = await handleEsignRequest(new Request("http://127.0.0.1/api/esign/assets/0.0.0/cmaps/missing.bcmap"), dependencies);
    assert.equal(response.status, 404); assert.equal(initialized, false);
});
