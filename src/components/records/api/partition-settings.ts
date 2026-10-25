import { apiRequest } from "@/lib/swr-fetcher";

/**
 * 파티션 설정 변경(PATCH /api/partitions/:id) — 열 표시·분배·중복 설정 공용.
 * 실패하면 RequestError를 던진다(서버의 한국어 안내 유지). sessionId는 자기 SSE 재수신 방지용.
 */
export function updatePartitionSettings(
    partitionId: number,
    data: Record<string, unknown>,
    sessionId?: string,
): Promise<{ success: true; data?: unknown }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (sessionId) headers["x-session-id"] = sessionId;
    return apiRequest(`/api/partitions/${partitionId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(data),
    });
}
