import { test } from "node:test";
import assert from "node:assert";
import { safeNextPath } from "./safe-next-path";

test("로그인 뒤 돌아갈 주소는 같은 사이트 경로만 (DV-12)", () => {
    assert.equal(safeNextPath("/records?id=4242"), "/records?id=4242");
    assert.equal(safeNextPath("/records/4242/journey"), "/records/4242/journey");
    assert.equal(safeNextPath("https://evil.test/x"), null);
    assert.equal(safeNextPath("//evil.test/x"), null);
    assert.equal(safeNextPath("/\\evil.test"), null);
    assert.equal(safeNextPath("/login?next=/x"), null);
    assert.equal(safeNextPath(""), null);
    assert.equal(safeNextPath(null), null);
});
