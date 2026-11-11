import type { FieldDefinition } from "@/types";
import type { LeadRecord, LeadSummary } from "../types";

// 사업부(파티션)마다 같은 뜻의 칸 key가 달라 후보를 순서대로 찾는다
const COMPANY_KEYS = ["companyName", "companyname", "company"];
const CONTACT_KEYS = ["contactName", "name"];
const PHONE_KEYS = ["phone", "contact", "mobile"];
const EMAIL_KEYS = ["email"];
const REQUEST_KEYS = ["note", "memo", "inquiry", "message"];
const REQUEST_LABELS = ["요청사항", "문의 내용", "문의내용"];
export const STATUS_KEY = "status";
const SOURCE_KEYS = ["source"];

/** 리드 추가 창의 기본 항목 — 파티션에 같은 뜻의 칸이 있으면 그 key를 쓴다 */
export const BASE_SLOTS = [
    { id: "company", label: "기업명", keys: COMPANY_KEYS },
    { id: "contactName", label: "담당자", keys: CONTACT_KEYS },
    { id: "status", label: "대응상태", keys: [STATUS_KEY] },
    { id: "phone", label: "연락처", keys: PHONE_KEYS },
    { id: "email", label: "이메일", keys: EMAIL_KEYS },
    { id: "request", label: "요청사항", keys: REQUEST_KEYS },
    { id: "source", label: "유입경로", keys: SOURCE_KEYS },
] as const;

/** 공통 항목으로 쓰는 key — 상세의 "기타 정보"에서는 뺀다 */
export const SUMMARY_KEYS = new Set([
    ...COMPANY_KEYS,
    ...CONTACT_KEYS,
    ...PHONE_KEYS,
    ...EMAIL_KEYS,
    ...REQUEST_KEYS,
    ...SOURCE_KEYS,
    STATUS_KEY,
    "nextContactAt",
]);

/** 기본 항목마다 실제로 저장할 key와 필드 정의 */
export function resolveBaseSlots(fields: FieldDefinition[]) {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    return BASE_SLOTS.map((slot) => {
        const candidates: string[] = slot.id === "request" ? requestKeys(fields) : [...slot.keys];
        const key = candidates.find((k) => byKey.has(k)) ?? candidates[0];
        return { id: slot.id, label: slot.label, key, field: byKey.get(key) ?? null };
    });
}

function text(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.join(", ");
    return String(v).trim();
}

function pick(data: Record<string, unknown>, keys: string[]): string {
    for (const k of keys) {
        const v = text(data[k]);
        if (v) return v;
    }
    return "";
}

/** 요청사항 칸 key — 라벨이 "요청사항/문의 내용"인 칸을 먼저, 없으면 흔한 key */
export function requestKeys(fields: FieldDefinition[]): string[] {
    const byLabel = fields.filter((f) => REQUEST_LABELS.includes(f.label.trim())).map((f) => f.key);
    return [...byLabel, ...REQUEST_KEYS];
}

export function summarizeLead(record: LeadRecord, fields: FieldDefinition[]): LeadSummary {
    const data = (record.data ?? {}) as Record<string, unknown>;
    return {
        company: pick(data, COMPANY_KEYS),
        contactName: pick(data, CONTACT_KEYS),
        phone: pick(data, PHONE_KEYS),
        email: pick(data, EMAIL_KEYS),
        request: pick(data, requestKeys(fields)),
        status: text(data[STATUS_KEY]),
    };
}

/** 상세 "기타 정보"에 보일 칸 — 공통 항목 외에 값이 있는 칸 */
export function extraFields(record: LeadRecord, fields: FieldDefinition[]) {
    const data = (record.data ?? {}) as Record<string, unknown>;
    const skip = new Set([...SUMMARY_KEYS, ...requestKeys(fields)]);
    return fields
        .filter((f) => !skip.has(f.key) && !f.isSystem)
        .map((f) => ({ key: f.key, label: f.label, value: text(data[f.key]) }))
        .filter((f) => f.value);
}

/** 상태 칩 색 — 필드 설정의 옵션 색(hex)을 연한 배경 + 진한 글자로 */
export function statusColorStyle(status: string, colors: Record<string, string> | null | undefined) {
    const hex = colors?.[status];
    if (!hex) return undefined;
    return { backgroundColor: `${hex}1f`, color: hex, borderColor: "transparent" };
}

/** 신규인데 등록 후 24시간이 지난 리드 */
export function isUnansweredOver24h(status: string, registeredAt: string | Date): boolean {
    if (status && status !== "신규") return false;
    return Date.now() - new Date(registeredAt).getTime() > 24 * 60 * 60 * 1000;
}

export function formatDate(value: string | Date): string {
    const d = new Date(value);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDateTime(value: string | Date): string {
    const d = new Date(value);
    return `${formatDate(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 등록일별로 묶기 — 표 첫 칸을 날짜별로 합친다 */
export function groupByDate(rows: LeadRecord[]): Array<{ date: string; rows: LeadRecord[] }> {
    const groups: Array<{ date: string; rows: LeadRecord[] }> = [];
    for (const r of rows) {
        const date = formatDate(r.registeredAt);
        const last = groups[groups.length - 1];
        if (last && last.date === date) last.rows.push(r);
        else groups.push({ date, rows: [r] });
    }
    return groups;
}
