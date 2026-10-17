/* eslint-disable @typescript-eslint/no-require-imports -- 허구 XLSX와 실제 정규화 로직의 오프라인 검사 */
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { convertContacts } = require("./convert-channel-contacts.cjs");
const load = require("tsx/cjs/api").require;
const { normalizeImport } = load("../src/lib/customer-imports/adapters.ts", __filename);
function file(rows, headers = ["id", "member", "memberId", "profile.name", "profile.email", "hasChat", "tags", "createdAt"]) {
    const w = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([headers, ...rows]), "User data");
    return XLSX.write(w, { type: "buffer", bookType: "xlsx" });
}
const record = ["source-qa", "false", "unverified-site-id", "허구 고객", "fictional@example.test", "false", "기업, 가입", "2026-01-02T03:04:05.000Z"];
const bytes = file([record]);
const bundle = convertContacts(bytes);
assert.equal(bundle.users.length, 1);
assert.equal(bundle.users[0].member, false);
assert.equal(bundle.users[0].hasChat, false);
assert.equal(bundle.users[0].tags, "기업, 가입");
assert.deepEqual(Object.values(bundle.users[0].exportRow), record);
const normalized = normalizeImport({ source: "channel", format: "json", content: JSON.stringify(bundle), expectedCounts: { contacts: 1 } });
assert.equal(normalized.rows[0].data.externalId, undefined, "문자열 false가 회원으로 승격되면 안 됨");
assert.equal(normalized.rows[0].data.email, "fictional@example.test");
assert.equal(normalized.warnings.length, 1);
assert.throws(() => convertContacts(file([record, record])), /중복/);
assert.throws(() => convertContacts(file([["id", "yes"]], ["id", "member"])), /올바르지/);
assert.throws(() => convertContacts(file([["id", false, "value"]], ["id", "member", "__proto__.polluted"])), /열 이름/);
assert.throws(() => convertContacts(file([["id", false, "scalar", "nested"]], ["id", "member", "profile", "profile.name"])), /열 이름/);
const missing = convertContacts(file([["source-qa", null]], ["id", "member"]));
assert.equal(missing.users[0].member, false);
console.log("PASS 채널톡 전체 고객 XLSX: 문자열 false·원본 열 보존·미확인 회원 ID·중복 ID·잘못된 열/값 검증");
