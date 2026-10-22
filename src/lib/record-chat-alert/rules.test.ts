import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecordAlertText, maskWebhookUrl, pickAlertFields, recordThreadKey } from "./rules";

const fields = [
    { key: "status", label: "상태", fieldType: "select" },
    { key: "companyName", label: "회사명", fieldType: "text" },
    { key: "name", label: "담당자", fieldType: "text" },
    { key: "wantsGov", label: "정부지원 희망", fieldType: "checkbox" },
    { key: "wantsLease", label: "리스 희망", fieldType: "checkbox" },
    { key: "note", label: "문의 내용", fieldType: "textarea" },
    { key: "registeredAt", label: "접수일시", fieldType: "datetime", isSystem: 1 },
];

test("값이 있는 필드만 정의 순서대로, 시스템 필드와 거짓 체크박스는 뺀다", () => {
    const picked = pickAlertFields(
        { companyName: "(주)A", name: " 홍길동 ", wantsGov: true, wantsLease: false, note: "", registeredAt: "2026-10-21", extra: "x" },
        fields
    );
    assert.deepEqual(picked, [
        { label: "회사명", value: "(주)A" },
        { label: "담당자", value: "홍길동" },
        { label: "정부지원 희망", value: "예" },
    ]);
});

test("긴 값은 자르고 줄바꿈은 한 줄로 만든다", () => {
    const [f] = pickAlertFields({ note: "가\n나 " + "다".repeat(200) }, fields);
    assert.equal(f.value.length, 100);
    assert.ok(f.value.startsWith("가 나 다"));
    assert.ok(f.value.endsWith("…"));
});

test("필드 수 상한", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, fieldType: "text" }));
    const data = Object.fromEntries(many.map((f) => [f.key, "v"]));
    assert.equal(pickAlertFields(data, many).length, 8);
});

test("알림 문구: 신규와 재접수", () => {
    const base = {
        source: "web_form" as const,
        workspaceName: "제조",
        partitionName: "설비지원몰 견적 요청",
        integratedCode: "SALES-0001",
        fields: [{ label: "회사명", value: "(주)A" }],
        recordUrl: "https://sendb.kr/records?id=7",
    };
    assert.equal(
        buildRecordAlertText({ ...base, kind: "created" }),
        "*[제조 > 설비지원몰 견적 요청] 신규 접수* · 웹폼 · SALES-0001\n회사명: (주)A\n<https://sendb.kr/records?id=7|샌드비에서 보기>"
    );
    assert.match(buildRecordAlertText({ ...base, kind: "merged", source: "api", integratedCode: null }), /^\*\[제조 > 설비지원몰 견적 요청\] 재접수\* · 외부 API\n/);
});

test("스레드 키와 웹훅 주소 가리기", () => {
    assert.equal(recordThreadKey(42), "sendb-record-42");
    assert.equal(
        maskWebhookUrl("https://chat.googleapis.com/v1/spaces/AAQAE_0X-24/messages?key=k&token=t"),
        "spaces/AAQA…-24"
    );
    assert.equal(maskWebhookUrl("https://example.com"), "알 수 없는 주소");
});
