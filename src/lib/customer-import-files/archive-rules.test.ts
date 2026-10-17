import assert from "node:assert/strict";
import test from "node:test";
import { fileAction, fileDescriptors } from "./rules";
const identity = { id: "00000000-0000-4000-8000-000000000001", version: 1, size: 21 * 1024 * 1024, sha256: "a".repeat(64) };
test("archive actions accept only bounded identity, never an arbitrary object key or URL", () => {
    for (const action of ["archive_plan", "archive_attach"]) {
        assert.equal(fileAction.safeParse({ action, ...identity }).success, true);
        for (const extra of [{ objectKey: "other-workspace/file" }, { url: "https://example.com" }, { size: 1024 ** 3 + 1 }, { sha256: "broken" }, { version: 0 }])
            assert.equal(fileAction.safeParse({ action, ...identity, ...extra }).success, false);
    }
});
test("large originals retain valid metadata only within the private archive cap", () => {
    assert.equal(fileDescriptors([{ id: "file", name: "large.bin", size: identity.size, sha256: identity.sha256 }])[0].invalid, false);
    assert.equal(fileDescriptors([{ id: "file", size: 1024 ** 3 + 1 }])[0].invalid, true);
    assert.equal(fileDescriptors([{ id: "file", size: identity.size, sha256: "broken" }])[0].invalid, true);
});
