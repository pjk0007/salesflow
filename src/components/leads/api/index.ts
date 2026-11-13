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

export async function fetchLead(recordId: number) {
    return json<import("../types").LeadRecord>(await fetch(`/api/records/${recordId}`));
}

/** 리드함이 없는 사업부에 리드함("문의")을 만든다 — 그 사업부가 모두의 리드관리 탭에 생긴다 */
export async function createLeadBox(workspaceId: number) {
    return json(
        await fetch(`/api/workspaces/${workspaceId}/partitions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "문의", category: "lead" }),
        }),
    );
}

/** 비어 있는 리드함을 지워 사업부를 리드관리에서 뺀다 (리드가 있으면 서버가 막는다) */
export async function removeLeadBox(workspaceId: number) {
    return json(await fetch(`/api/leads/workspaces/${workspaceId}`, { method: "DELETE" }).catch(() => new Response("{}")));
}
