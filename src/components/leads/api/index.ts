// 리드 관리 화면의 저장·삭제 요청 — 여러 상태 묶음이 같이 갱신되도록 SWR 키는 화면에서 한꺼번에 새로고침한다

async function json<T = unknown>(res: Response): Promise<{ success: boolean; data?: T; error?: string }> {
    return res.json();
}

export async function createLead(partitionId: number, data: Record<string, unknown>) {
    return json(
        await fetch(`/api/partitions/${partitionId}/records`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data }),
        }),
    );
}

export async function updateLead(recordId: number, data: Record<string, unknown>) {
    return json(
        await fetch(`/api/records/${recordId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data }),
        }),
    );
}

export async function deleteLeads(ids: number[]) {
    return json(
        await fetch("/api/records/bulk-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
        }),
    );
}
