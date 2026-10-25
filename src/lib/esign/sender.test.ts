import { test } from "node:test";
import assert from "node:assert/strict";
import { selectEsignAlimtalkSenderKey, selectEsignEmailSender } from "./sender";

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
test("UX-265: 전용 주소가 없는 조직은 자기 기본 발신자를 쓰고 다른 조직 주소로 대체하지 않는다", () => {
    // 이 조직 프로필·레거시 설정에 없는 전용 주소 → 이 조직의 기본 발신자(같은 조직 안에서만 선택).
    assert.deepEqual(selectEsignEmailSender("contract@example.test", profiles.slice(0, 1), { fromEmail: "legacy@example.test" }), { fromEmail: "default@example.test", fromName: "기존 기본 발신자", profileId: 1 });
    assert.equal(selectEsignEmailSender("unknown@other-brand.test", profiles, null).fromEmail, "default@example.test");
    assert.equal(selectEsignEmailSender("unknown@other-brand.test", [], { fromEmail: "legacy@example.test", fromName: "레거시" }).fromEmail, "legacy@example.test");
    // 발신자를 하나도 설정하지 않은 조직은 여전히 설정 필요(null).
    assert.equal(selectEsignEmailSender("contract@example.test", [], null).fromEmail, null);
});
test("UX-265: 고정 알림톡 발신 키는 소유 조직에만 쓰고 다른 조직은 기본 채널을 쓴다", () => {
    const owner = "00000000-0000-4000-8000-0000000000a1", other = "00000000-0000-4000-8000-0000000000b2";
    assert.equal(selectEsignAlimtalkSenderKey({ fixedKey: "FIXED", fixedOrgId: owner, orgId: owner, defaultSenderKey: "OWNER_DEFAULT" }), "FIXED");
    assert.equal(selectEsignAlimtalkSenderKey({ fixedKey: "FIXED", fixedOrgId: owner, orgId: other, defaultSenderKey: "OTHER_DEFAULT" }), "OTHER_DEFAULT");
    assert.equal(selectEsignAlimtalkSenderKey({ fixedKey: "FIXED", orgId: other, defaultSenderKey: "OTHER_DEFAULT" }), "OTHER_DEFAULT");
    assert.equal(selectEsignAlimtalkSenderKey({ fixedKey: "FIXED", orgId: owner, defaultSenderKey: "FIXED" }), "FIXED");
    assert.equal(selectEsignAlimtalkSenderKey({ orgId: other, defaultSenderKey: "OTHER_DEFAULT" }), "OTHER_DEFAULT");
    assert.equal(selectEsignAlimtalkSenderKey({ fixedKey: "FIXED", fixedOrgId: owner, orgId: other, defaultSenderKey: null }), null);
});
test("해당 조직의 레거시 발신 설정과 주소가 일치하는 경우에만 사용한다", () => {
    assert.deepEqual(selectEsignEmailSender("legacy@example.test", profiles, { fromEmail: "legacy@example.test", fromName: "레거시 담당자" }), { fromEmail: "legacy@example.test", fromName: "레거시 담당자", profileId: null });
});
