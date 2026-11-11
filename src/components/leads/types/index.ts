import type { DbRecord } from "@/lib/db";
import type { LeadInflow } from "@/lib/leads/inflow";

export type { LeadInflow };

/** 리드 관리 표 한 줄 — 레코드 + 댓글 수/마지막 댓글 */
export type LeadRecord = DbRecord & {
    memoCount?: number;
    latestMemo?: string | null;
    inflow?: LeadInflow;
};

/** 사업부마다 칸 이름이 달라서 공통 항목으로 뽑아 쓴 값 */
export interface LeadSummary {
    company: string;
    contactName: string;
    phone: string;
    email: string;
    request: string;
    status: string;
}
