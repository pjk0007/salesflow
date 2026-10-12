import type { ReplyFilters, ReplyPatch } from "../types";

/** 회신 목록 주소 (SWR 키) — GET /api/email/replies */
export function repliesKey(f: ReplyFilters): string {
    const qs = new URLSearchParams();
    if (f.page && f.page > 1) qs.set("page", String(f.page));
    if (f.pageSize) qs.set("pageSize", String(f.pageSize));
    if (f.kind) qs.set("kind", f.kind);
    if (f.matchStatus) qs.set("matchStatus", f.matchStatus);
    if (f.handled) qs.set("handled", f.handled);
    if (f.workspaceId) qs.set("workspaceId", String(f.workspaceId));
    if (f.recordId) qs.set("recordId", String(f.recordId));
    if (f.id) qs.set("id", String(f.id));
    const q = qs.toString();
    return `/api/email/replies${q ? `?${q}` : ""}`;
}

/** 회신 탭을 보일지 (SWR 키) — GET /api/email/replies/status */
export const REPLIES_STATUS_KEY = "/api/email/replies/status";

/** 규칙별 회신 수 (SWR 키) — 규칙 목록·AI 규칙 카드가 같은 키를 쓴다 */
export const REPLY_STATS_KEY = "/api/email/replies/stats?days=28";

/** [처리함]·[분류 고치기]·[자동 메일 다시 허용] */
export async function patchReply(id: number, body: ReplyPatch): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`/api/email/replies/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    try {
        return (await res.json()) as { success: boolean; error?: string };
    } catch {
        return { success: false, error: "응답을 읽지 못했습니다." };
    }
}
