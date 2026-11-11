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
/** 웹폼 유입 추적·메타 리드 광고가 자동으로 채우는 칸 (src/lib/attribution, meta-lead-record) */
export const AUTO_FILLED_KEYS = new Set(["campaignName", "adName"]);
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
    "owner",
    "contactTitle",
    "profileNote",
    "address",
    "leadGroupId",
    ...AUTO_FILLED_KEYS,
]);

/** 기본 항목마다 실제로 저장할 key와 필드 정의 */
/** 영업관리 리드 추가 창 — 모든 사업 같은 칸 (상태·요청사항·유입경로 없음) */
const SALES_SLOTS = [
    { id: "company", label: "기업명", keys: COMPANY_KEYS },
    { id: "contactName", label: "이름", keys: CONTACT_KEYS },
    { id: "contactTitle", label: "직책", keys: ["contactTitle", "title", "position"] },
    { id: "phone", label: "연락처", keys: PHONE_KEYS },
    { id: "email", label: "이메일", keys: EMAIL_KEYS },
    { id: "address", label: "회사 주소", keys: ["address"] },
    { id: "memo", label: "메모", keys: ["profileNote"] },
] as const;

export function resolveBaseSlots(fields: FieldDefinition[], mode: "lead" | "sales" = "lead") {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const list: ReadonlyArray<{ id: string; label: string; keys: readonly string[] }> = mode === "sales" ? SALES_SLOTS : BASE_SLOTS;
    return list.map((slot) => {
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

/** 같은 기업 판단용 이름 — (주)·㈜·주식회사·띄어쓰기를 빼고 소문자 (서버 src/lib/sales/related.ts와 같은 규칙) */
export function companyKey(name: unknown): string {
    return String(name ?? "")
        .toLowerCase()
        .replace(/\(주\)|㈜|주식회사|\s/g, "");
}

/**
 * 영업관리 표 — 같은 기업(또는 직접 묶은 연관 리드)끼리 묶는다. 묶음 순서는 처음 나온 순서(최신순).
 * date 자리에 기업 이름을 넣어 표 첫 칸에 보여준다.
 */
export function groupByCompany(rows: LeadRecord[]): Array<{ date: string; rows: LeadRecord[] }> {
    const keyOf = (r: LeadRecord) => {
        const d = (r.data ?? {}) as Record<string, unknown>;
        if (typeof d.leadGroupId === "string" && d.leadGroupId) return `g:${d.leadGroupId}`;
        const k = companyKey(d.companyName ?? d.companyname);
        return k ? `c:${k}` : `r:${r.id}`;
    };
    // 직접 묶은 그룹과 같은 기업명이 섞이면 한 묶음으로 보이게, 기업명 → 그룹 키를 먼저 잇는다
    const alias = new Map<string, string>();
    for (const r of rows) {
        const d = (r.data ?? {}) as Record<string, unknown>;
        const k = companyKey(d.companyName ?? d.companyname);
        if (k && typeof d.leadGroupId === "string" && d.leadGroupId && !alias.has(`c:${k}`)) alias.set(`c:${k}`, `g:${d.leadGroupId}`);
    }
    const groups = new Map<string, { date: string; rows: LeadRecord[] }>();
    for (const r of rows) {
        const raw = keyOf(r);
        const key = alias.get(raw) ?? raw;
        const d = (r.data ?? {}) as Record<string, unknown>;
        const g = groups.get(key) ?? { date: String(d.companyName ?? d.companyname ?? "").trim() || "(기업명 없음)", rows: [] };
        g.rows.push(r);
        groups.set(key, g);
    }
    return [...groups.values()];
}
