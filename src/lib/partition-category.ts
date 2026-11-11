// 파티션·폴더·속성 타입 구분 — 화면·서버 공용
// cold: 레코드(메일 발송용), lead: 리드관리, sales: 영업관리(직접 만난 B2B)
export const PARTITION_CATEGORIES = ["cold", "lead", "sales"] as const;
export type PartitionCategory = (typeof PARTITION_CATEGORIES)[number];

export function isPartitionCategory(v: unknown): v is PartitionCategory {
    return typeof v === "string" && (PARTITION_CATEGORIES as readonly string[]).includes(v);
}
