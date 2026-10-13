import type { FollowupDetail, FollowupPatch } from "../types";
export class FollowupApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
export async function saveFollowup(recordId: number, patch: FollowupPatch): Promise<FollowupDetail> {
    const response = await fetch(`/api/records/${recordId}/lead-followup`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new FollowupApiError(result.error || "저장하지 못했습니다.", response.status);
    return result.data;
}
