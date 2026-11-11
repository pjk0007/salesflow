import type { CardFields, DraftActionItem } from "../types";

type Result<T> = { success: boolean; data?: T; error?: string };
const json = async <T,>(res: Response): Promise<Result<T>> => res.json();
const send = (url: string, method: string, body?: unknown) =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const scanBusinessCard = async (image: File) => {
    const form = new FormData();
    form.append("image", image);
    return json<CardFields>(await fetch("/api/sales/business-card", { method: "POST", body: form }));
};

export const transcribeRecording = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return json<{ audioUrl: string; transcript: string }>(await fetch("/api/sales/transcribe", { method: "POST", body: form }));
};

export const analyzeMeeting = async (input: { transcript: string; notes: string; meetingDate: string }) =>
    json<{ summary: string; actionItems: Array<{ content: string; dueDate: string | null; ownerName: string | null }> }>(
        await send("/api/sales/analyze", "POST", input),
    );

export interface MeetingPayload {
    metAt: string;
    title: string;
    attendees: string;
    notes: string;
    transcript: string;
    summary: string;
    audioUrl: string | null;
    actionItems: DraftActionItem[];
}

export const createMeeting = async (recordId: number, input: MeetingPayload) =>
    json(await send(`/api/records/${recordId}/meetings`, "POST", input));

export const updateMeeting = async (meetingId: number, input: MeetingPayload) =>
    json(await send(`/api/sales/meetings/${meetingId}`, "PATCH", input));

export const deleteMeeting = async (meetingId: number) => json(await send(`/api/sales/meetings/${meetingId}`, "DELETE"));

export const addActionItem = async (input: { recordId: number; content: string; ownerId: string | null; dueDate: string | null; meetingId?: number | null }) =>
    json(await send("/api/sales/action-items", "POST", input));

export const updateActionItem = async (id: number, input: { done?: boolean; content?: string; ownerId?: string | null; dueDate?: string | null }) =>
    json(await send(`/api/sales/action-items/${id}`, "PATCH", input));

export const deleteActionItem = async (id: number) => json(await send(`/api/sales/action-items/${id}`, "DELETE"));

export const linkLeads = async (recordIds: number[], companyName: string) =>
    json<{ groupId: string; count: number }>(await send("/api/sales/link", "POST", { recordIds, companyName }));

export const createSalesLead = async (workspaceIds: number[], data: Record<string, unknown>) =>
    json(await send("/api/sales/leads", "POST", { workspaceIds, data }));

export const unlinkLead = async (recordId: number, companyName?: string) =>
    json(await send(`/api/records/${recordId}/related`, "DELETE", companyName ? { companyName } : {}));

export const saveCompanyAddress = async (recordId: number, address: string) =>
    json<{ count: number }>(await send("/api/sales/company", "POST", { recordId, address }));

export const unlinkLeads = async (recordIds: number[]) =>
    json<{ done: number; skipped: number }>(await send("/api/sales/unlink", "POST", { recordIds }));

export const setLeadWorkspaces = async (recordId: number, workspaceIds: number[]) =>
    json<{ id: number; workspaceId: number; partitionId: number; data: Record<string, unknown> }>(
        await send(`/api/sales/leads/${recordId}/workspaces`, "PUT", { workspaceIds }),
    );
