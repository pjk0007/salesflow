import test from "node:test";
import assert from "node:assert/strict";
import { recordFieldValue } from "./field-value";

const record = {
    data: { companyName: "가상상사", registeredAt: "data에 남은 값" },
    registeredAt: "2026-10-25T10:34:00.000Z",
    updatedAt: "2026-10-25T11:00:00.000Z",
};

test("UI확인-R3 시스템 매핑 속성(등록일·수정일)은 레코드 시스템 컬럼에서 읽어 상세 패널에 '-'로 비지 않는다", () => {
    assert.equal(recordFieldValue(record, { key: "registeredAt", systemColumn: "registeredAt" }), record.registeredAt);
    assert.equal(recordFieldValue(record, { key: "updatedAt", systemColumn: "updatedAt" }), record.updatedAt);
});

test("일반 속성은 data에서 읽는다", () => {
    assert.equal(recordFieldValue(record, { key: "companyName", systemColumn: null }), "가상상사");
    assert.equal(recordFieldValue({ data: null }, { key: "companyName" }), undefined);
});
