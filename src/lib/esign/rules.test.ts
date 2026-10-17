import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnvelope, uniqueImageBudget, validateValues } from "./rules";
import type { EsignChannel, EsignEnvelopeInput, EsignField, EsignValue } from "./types";
const now = new Date("2026-10-18T01:00:00.000Z");
function request(phone?: string, channels: EsignChannel[] = ["sms"]): EsignEnvelopeInput {
    return { documentId: "00000000-0000-4000-8000-000000000031", title: "가상 SMS 계약", order: "parallel", expiresAt: "2026-10-19T01:00:00.000Z", recipients: [{ name: "가상 수신자", email: "fake@example.invalid", ...(phone ? { phone } : {}), channels }] };
}
test("SMS national numbers lose spaces/hyphens and preserve valid mobile prefixes", () => {
    assert.equal(parseEnvelope(request("010-1234-5678"), now).recipients[0].phone, "01012345678");
    assert.equal(parseEnvelope(request(" 011 123 4567 "), now).recipients[0].phone, "0111234567");
});
test("Korean +82 mobile numbers normalize to the NHN domestic recipient format", () => {
    for (const phone of ["+821012345678", "+82 10-1234-5678", "+82 010 1234 5678"])
        assert.equal(parseEnvelope(request(phone), now).recipients[0].phone, "01012345678");
    assert.equal(parseEnvelope(request("+82 11 123 4567"), now).recipients[0].phone, "0111234567");
});
test("SMS rejects foreign, landline, internet-phone and missing numbers before creating delivery work", () => {
    for (const phone of ["+12025550123", "+442079460018", "+82212345678", "02-1234-5678", "070-1234-5678", "01012345", undefined])
        assert.throws(() => parseEnvelope(request(phone), now), /국내 휴대폰/);
});
test("two-channel recipients use one normalized domestic mobile snapshot", () => {
    const parsed = parseEnvelope(request("+82 10 1234 5678", ["email", "sms"]), now);
    assert.equal(parsed.recipients.length, 1);
    assert.deepEqual(parsed.recipients[0].channels, ["email", "sms"]);
    assert.equal(parsed.recipients[0].phone, "01012345678");
});
test("email-only auxiliary numbers keep their international prefix and are not treated as SMS destinations", () => {
    assert.equal(parseEnvelope(request("+44 20-7946-0018", ["email"]), now).recipients[0].phone, "+442079460018");
    assert.equal(parseEnvelope(request("+82 10-1234-5678", ["email"]), now).recipients[0].phone, "+821012345678");
    assert.equal(parseEnvelope(request(undefined, ["email"]), now).recipients[0].phone, undefined);
});
test("each PNG requires decoded raster metadata and respects dimension/pixel caps", () => {
    const field: EsignField = { id: "signature", recipientIndex: 0, type: "signature", pageIndex: 0, x: 0, y: 0, width: 0.2, height: 0.1, required: true };
    const value: EsignValue = { fieldId: field.id, artifact: { key: "esign/signatures/fake/fake/test.png", sha256: "a".repeat(64), size: 500, contentType: "image/png" }, raster: { width: 100, height: 50 } };
    assert.equal(validateValues([field], 0, [value])[0].raster.width, 100);
    for (const raster of [undefined, { width: 4097, height: 1 }, { width: 1, height: 4097 }, { width: 2000, height: 1001 }, { width: 0, height: 50 }, { width: 1.5, height: 50 }])
        assert.throws(() => validateValues([field], 0, [{ ...value, raster }]));
    assert.equal(validateValues([field], 0, [{ ...value, raster: { width: 1000, height: 2000 } }])[0].raster.height, 2000);
});
test("unique image budgets use pixels plus bytes and reject inconsistent same-hash metadata", () => {
    const value: EsignValue = { fieldId: "one", artifact: { key: "esign/signatures/fake/fake/one.png", sha256: "a".repeat(64), size: 500, contentType: "image/png" }, raster: { width: 100, height: 50 } };
    assert.deepEqual(uniqueImageBudget([value, { ...value, fieldId: "two" }]), { bytes: 500, pixels: 5000 });
    assert.throws(() => uniqueImageBudget([value, { ...value, raster: { width: 50, height: 100 } }]), /크기 정보/);
    assert.throws(() => uniqueImageBudget([value, { ...value, artifact: { ...value.artifact!, size: 501 } }]), /크기 정보/);
});
