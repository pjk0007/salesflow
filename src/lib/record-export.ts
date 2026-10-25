import { parseCheckboxValue } from "@/lib/checkbox-value";
import { formatKstDateTime, kstParts } from "@/lib/kst";
import { isValidYmd } from "@/lib/tracker/date-range";

/** 한 번에 내보내는 최대 행 수 — 화면은 총 건수가 이보다 많으면 먼저 확인을 받는다(UX-072) */
export const RECORD_EXPORT_LIMIT = 10000;

/** 내보내지 않는 속성 타입 */
export const EXPORT_EXCLUDED_TYPES = ["file", "formula", "user_select"];

interface ExportField {
    key: string;
    label: string;
    fieldType: string;
    systemColumn?: string | null;
}

interface ExportRecord {
    integratedCode: string | null;
    data: unknown;
}

/**
 * 셀 값 → CSV 문자열. 날짜·일시는 화면과 같은 KST(서버 시간대 무관), 체크박스는 parseCheckboxValue 규칙("false"는 FALSE).
 * 시스템 항목(등록일·수정일)의 Date 값은 속성 타입과 무관하게 KST 일시로 쓴다(UX-073).
 */
export function formatExportValue(value: unknown, fieldType: string): string {
    if (value === null || value === undefined) return "";
    switch (fieldType) {
        case "date": {
            if (typeof value === "string" && isValidYmd(value)) return value;
            const d = value instanceof Date ? value : new Date(String(value));
            return Number.isNaN(d.getTime()) ? String(value) : kstParts(d).date;
        }
        case "datetime": {
            const d = value instanceof Date ? value : new Date(String(value));
            return Number.isNaN(d.getTime()) ? String(value) : formatKstDateTime(d);
        }
        case "checkbox":
            return parseCheckboxValue(value) ? "TRUE" : "FALSE";
        default:
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : formatKstDateTime(value);
            return String(value);
    }
}

export function escapeCsv(val: string): string {
    if (/[",\r\n]/.test(val)) {
        return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
}

/** BOM + 헤더(통합코드 + 속성 이름) + 행. 시스템 항목은 data가 아니라 레코드 컬럼을 읽는다 — RecordTable과 같은 규칙 */
export function buildRecordsCsv(rows: ExportRecord[], fields: ExportField[]): string {
    const exportFields = fields.filter((f) => !EXPORT_EXCLUDED_TYPES.includes(f.fieldType));
    const header = ["통합코드", ...exportFields.map((f) => f.label)];
    const lines = rows.map((record) => {
        const d = (record.data ?? {}) as Record<string, unknown>;
        return [
            record.integratedCode || "",
            ...exportFields.map((f) =>
                formatExportValue(
                    f.systemColumn ? (record as unknown as Record<string, unknown>)[f.systemColumn] : d[f.key],
                    f.fieldType,
                ),
            ),
        ]
            .map(escapeCsv)
            .join(",");
    });
    return "﻿" + [header.map(escapeCsv).join(","), ...lines].join("\n");
}

/** 내보내기 파일 이름 — 날짜는 KST(오전 9시 전에도 오늘 날짜) */
export function recordExportFileName(partitionName: string | null | undefined, now = new Date()): string {
    return `${partitionName || "records"}_${kstParts(now).date.replace(/-/g, "")}.csv`;
}
