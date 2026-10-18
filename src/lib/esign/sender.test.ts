import { test } from "node:test";
import assert from "node:assert/strict";
import { selectEsignEmailSender } from "./sender";

const profiles = [
    { id: 1, fromEmail: "default@example.test", fromName: "기존 기본 발신자", isDefault: true },
    { id: 2, fromEmail: "contract@example.test", fromName: "계약 담당자", isDefault: false },
];
test("전자서명 전용 주소를 선택해도 기존 조직 기본 발신자는 바뀌지 않는다", () => {
    const before = structuredClone(profiles);
    assert.deepEqual(selectEsignEmailSender(" CONTRACT@example.test ", profiles, null), { fromEmail: "contract@example.test", fromName: "계약 담당자", profileId: 2 });
    assert.deepEqual(profiles, before);
    assert.equal(selectEsignEmailSender(undefined, profiles, null).fromEmail, "default@example.test");
});
test("다른 조직 주소·삭제된 전용 주소는 다른 브랜드로 대체하지 않는다", () => {
    assert.deepEqual(selectEsignEmailSender("contract@example.test", profiles.slice(0, 1), { fromEmail: "legacy@example.test" }), { fromEmail: null, profileId: null });
    assert.deepEqual(selectEsignEmailSender("unknown@example.test", profiles, null), { fromEmail: null, profileId: null });
});
test("해당 조직의 레거시 발신 설정과 주소가 일치하는 경우에만 사용한다", () => {
    assert.deepEqual(selectEsignEmailSender("legacy@example.test", profiles, { fromEmail: "legacy@example.test", fromName: "레거시 담당자" }), { fromEmail: "legacy@example.test", fromName: "레거시 담당자", profileId: null });
});
