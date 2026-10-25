import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordsCsv, formatExportValue, recordExportFileName } from "./record-export";

// UX-073 — 내보내기 값은 서버 시간대와 무관하게 KST, 시스템 항목은 레코드 컬럼, 파일명 날짜도 KST.

test("datetime은 KST: UTC 15:30 → 다음날 00:30, UTC 00:30 → 09:30", () => {
    assert.equal(formatExportValue("2026-10-17T15:30:00.000Z", "datetime"), "2026-10-18 00:30");
    assert.equal(formatExportValue("2026-10-18T00:30:00.000Z", "datetime"), "2026-10-18 09:30");
    assert.equal(formatExportValue("미정", "datetime"), "미정");
    assert.equal(formatExportValue("2026-10-18", "date"), "2026-10-18");
});

test("체크박스 'false'·'0'·빈 값은 FALSE", () => {
    assert.equal(formatExportValue("false", "checkbox"), "FALSE");
    assert.equal(formatExportValue("0", "checkbox"), "FALSE");
    assert.equal(formatExportValue(true, "checkbox"), "TRUE");
    assert.equal(formatExportValue("TRUE", "checkbox"), "TRUE");
});

test("시스템 항목(등록일·수정일)은 data가 아닌 레코드 컬럼을 KST로, 제외 타입은 빼고, 쉼표·줄바꿈은 따옴표", () => {
    const csv = buildRecordsCsv(
        [
            {
                integratedCode: "SALES-0012",
                data: { name: "홍, 길동", memo: "첫 줄\n둘째 줄", registeredAt: "data에 있으면 안 됨", file: "x" },
                registeredAt: new Date("2026-10-17T15:30:00.000Z"),
                updatedAt: new Date("2026-10-18T00:30:00.000Z"),
            } as never,
        ],
        [
            { key: "name", label: "이름", fieldType: "text" },
            { key: "memo", label: "메모", fieldType: "textarea" },
            { key: "reg", label: "등록일", fieldType: "datetime", systemColumn: "registeredAt" },
            { key: "upd", label: "수정일", fieldType: "text", systemColumn: "updatedAt" },
            { key: "file", label: "파일", fieldType: "file" },
        ],
    );
    assert.equal(csv.charCodeAt(0), 0xfeff);
    const [header, ...rest] = csv.slice(1).split("\n");
    assert.equal(header, "통합코드,이름,메모,등록일,수정일");
    assert.equal(rest.join("\n"), 'SALES-0012,"홍, 길동","첫 줄\n둘째 줄",2026-10-18 00:30,2026-10-18 09:30');
});

test("파일 이름 날짜는 KST — UTC 23:59(KST 다음날 08:59)에도 KST 날짜", () => {
    assert.equal(recordExportFileName("신규 리드", new Date("2026-10-17T23:59:00.000Z")), "신규 리드_20261018.csv");
    assert.equal(recordExportFileName(null, new Date("2026-10-18T00:00:00.000Z")), "records_20261018.csv");
});
