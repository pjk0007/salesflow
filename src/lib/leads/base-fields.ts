import { eq, max } from "drizzle-orm";
import { db, fieldDefinitions } from "@/lib/db";
import { LEAD_STATUS_COLORS, LEAD_STATUS_DEFAULTS } from "./statuses";

// 새로 만드는 상태 칸의 선택지 — 테스트는 사업마다 설정에서 켠다
const LEAD_STATUS_OPTIONS = LEAD_STATUS_DEFAULTS.filter((s) => s !== "테스트");

/**
 * 리드 기본 칸 — 같은 뜻의 칸(key 또는 라벨)이 하나라도 있으면 그대로 두고, 없을 때만 만든다.
 * drizzle/0130_lead_base_fields.sql 과 같은 규칙.
 */
const BASE_FIELDS: Array<{
    keys: string[];
    labels?: string[];
    add: { key: string; label: string; fieldType: string; options?: string[]; optionColors?: Record<string, string>; trackHistory?: number; isGroupable?: number };
}> = [
    { keys: ["companyName", "companyname"], add: { key: "companyName", label: "기업명", fieldType: "text" } },
    { keys: ["contactName", "name"], add: { key: "name", label: "담당자", fieldType: "text" } },
    {
        keys: ["status"],
        add: { key: "status", label: "대응상태", fieldType: "select", options: [...LEAD_STATUS_OPTIONS], optionColors: LEAD_STATUS_COLORS, trackHistory: 1, isGroupable: 1 },
    },
    { keys: ["phone", "contact"], add: { key: "phone", label: "연락처", fieldType: "phone" } },
    { keys: ["email"], add: { key: "email", label: "이메일", fieldType: "email" } },
    { keys: ["note", "memo"], labels: ["요청사항", "문의 내용", "문의내용"], add: { key: "note", label: "요청사항", fieldType: "textarea" } },
    { keys: ["source"], add: { key: "source", label: "유입경로", fieldType: "text" } },
];

/** 리드 파티션이 쓰는 속성 타입에 기본 칸이 없으면 채운다 */
export async function ensureLeadBaseFields(fieldTypeId: number | null | undefined) {
    if (!fieldTypeId) return;
    const existing = await db
        .select({ key: fieldDefinitions.key, label: fieldDefinitions.label })
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.fieldTypeId, fieldTypeId));
    const keys = new Set(existing.map((f) => f.key));
    const labels = new Set(existing.map((f) => f.label.trim()));
    const missing = BASE_FIELDS.filter(
        (b) => !b.keys.some((k) => keys.has(k)) && !(b.labels ?? []).some((l) => labels.has(l)),
    );
    if (missing.length === 0) return;

    const [{ value: lastOrder } = { value: 0 }] = await db
        .select({ value: max(fieldDefinitions.sortOrder) })
        .from(fieldDefinitions)
        .where(eq(fieldDefinitions.fieldTypeId, fieldTypeId));
    await db.insert(fieldDefinitions).values(
        missing.map((b, i) => ({
            fieldTypeId,
            key: b.add.key,
            label: b.add.label,
            fieldType: b.add.fieldType,
            options: b.add.options ?? null,
            optionColors: b.add.optionColors ?? null,
            trackHistory: b.add.trackHistory ?? 0,
            isGroupable: b.add.isGroupable ?? 0,
            sortOrder: (lastOrder ?? 0) + i + 1,
        })),
    );
}

export async function ensureLeadBaseFieldsForTypes(fieldTypeIds: Array<number | null | undefined>) {
    for (const id of new Set(fieldTypeIds.filter((v): v is number => !!v))) {
        await ensureLeadBaseFields(id);
    }
}
