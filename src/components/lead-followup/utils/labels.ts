import type { AssessedLead } from "../types";
export const PRIORITY_LABELS = { normal: "일반 방문", highlight: "관심 높음 · 이탈", urgent: "핵심 리드 이탈 · 담당자 확인 필요" } as const;
export function journeyPriorityLabel(priority: AssessedLead["priority"]) {
    return priority.tier === "highlight" && priority.coreIcp ? "핵심 ICP · 이탈" : PRIORITY_LABELS[priority.tier];
}
export function toKstInput(iso: string | null) {
    return iso ? new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 16) : "";
}
export function fromKstInput(value: string): string | null {
    if (!value) return null;
    const date = new Date(`${value}+09:00`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export const kstDisplay = (value: string) => `${toKstInput(value).replace("T", " ")} KST`;
