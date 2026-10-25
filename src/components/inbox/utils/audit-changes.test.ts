import test from "node:test";
import assert from "node:assert/strict";
import { objectChanges } from "./audit-changes";
test("UX-114 운영 설정·상담창 설정 객체는 바뀐 하위 항목만 한국어로 펼친다", () => {
    const policy = { enabled: true, showHours: true, firstMinutes: 10, calendar: { weekly: [] } };
    assert.deepEqual(
        objectChanges({ version: 1, policy }, { version: 2, policy: { ...policy, firstMinutes: 30 } }),
        [{ field: "첫 응답 목표(분)", before: 10, after: 30 }],
    );
    assert.deepEqual(
        objectChanges({ enabled: false, tagline: "" }, { enabled: false, tagline: "안녕하세요" }),
        [{ field: "소개 문구", before: "", after: "안녕하세요" }],
    );
    assert.equal(objectChanges(null, { version: 1, policy })!.length, 4, "처음 저장은 모든 항목");
    assert.equal(objectChanges("open", "closed"), null, "기존 단일 값은 그대로");
    assert.equal(objectChanges(["a"], ["b"]), null);
});
