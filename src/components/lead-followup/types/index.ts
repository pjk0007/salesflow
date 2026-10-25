export const FOLLOWUP_LABELS = {
    new: "미확인", planned: "연락 예정", contacted: "연락 완료", consulting: "상담 진행",
} as const;
export type FollowupStatus = keyof typeof FOLLOWUP_LABELS;
export interface LeadFollowup {
    status: FollowupStatus;
    dueAt: string | null;
    note: string;
    revision: number;
    updatedAt: string | null;
    updatedBy: string | null;
    lastRemindedAt: string | null;
    reminderCount: number;
}
export interface AssessedLead {
    alertId: number;
    recordId: number;
    workspaceId: number;
    customerKey: string;
    businessName: string;
    company: string;
    person: string;
    email: string;
    stage: string;
    totalSeconds: number | null;
    assessedAt: string;
    priority: JourneyPriority;
    ownerName: string | null;
    followup: LeadFollowup;
}
export interface FollowupHistory {
    at: string;
    status: FollowupStatus;
    dueAt: string | null;
    note: string;
    actorName: string;
}
export interface FollowupDetail {
    lead: AssessedLead | null;
    history: FollowupHistory[];
    /** 유효 판정이 없을 때 남아 있는 마지막 처리 상태 (읽기 전용) */
    archivedFollowup?: LeadFollowup | null;
    /** 유효 판정이 없는 이유 (완료·30일 경과·제외 조건 등) */
    excludedReason?: string | null;
}
export interface FollowupPatch { status: FollowupStatus; dueAt: string | null; note: string; revision: number }
import type { JourneyPriority } from "../../../lib/customer-journey-priority";
