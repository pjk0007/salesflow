import { FOLLOWUP_LABELS, type FollowupPatch, type LeadFollowup } from "../components/lead-followup/types";
import { isBusinessHours } from "./kst";

export const FOLLOWUP_DAY_MS = 24 * 60 * 60 * 1000;
export function parseFollowupPatch(value: unknown): FollowupPatch {
    if (!value || typeof value !== "object") throw new Error("처리 상태를 확인해 주세요.");
    const v = value as Record<string, unknown>;
    if (typeof v.status !== "string" || !Object.hasOwn(FOLLOWUP_LABELS, v.status)) throw new Error("올바른 처리 상태를 선택해 주세요.");
    if (!Number.isSafeInteger(v.revision) || Number(v.revision) < 0) throw new Error("처리 상태를 새로 불러와 주세요.");
    if (typeof v.note !== "string" || v.note.length > 2000) throw new Error("메모는 2,000자 이내로 입력해 주세요.");
    let dueAt: string | null = null;
    if (v.status === "planned") {
        if (typeof v.dueAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(v.dueAt) || !Number.isFinite(new Date(v.dueAt).getTime())) {
            throw new Error("연락 예정 시각을 입력해 주세요.");
        }
        dueAt = new Date(v.dueAt).toISOString();
    }
    return { status: v.status as FollowupPatch["status"], dueAt, note: v.note.trim(), revision: Number(v.revision) };
}

/** 미확인은 24시간 뒤, 연락 예정은 기한 뒤. 근무시간에만 최대 3회, 태그는 24시간 간격. */
export function shouldRemindLead(input: {
    urgent: boolean; firstUrgentAt: string | null; followup: LeadFollowup; lastMentionedAt?: string | null;
}, now: Date): boolean {
    const f = input.followup;
    if (!input.urgent || !input.firstUrgentAt || !isBusinessHours(now) || f.reminderCount >= 3) return false;
    if (f.status !== "new" && f.status !== "planned") return false;
    const due = f.status === "planned" ? Date.parse(f.dueAt ?? "")
        : Math.max(Date.parse(input.firstUrgentAt), Date.parse(f.updatedAt ?? input.firstUrgentAt)) + FOLLOWUP_DAY_MS;
    const latest = Math.max(Date.parse(f.lastRemindedAt ?? "") || 0, Date.parse(input.lastMentionedAt ?? "") || 0);
    return Number.isFinite(due) && due <= now.getTime() && latest <= now.getTime() - FOLLOWUP_DAY_MS;
}
