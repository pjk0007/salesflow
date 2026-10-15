import { inboxRequest, inboxWrite } from "@/components/inbox/api";
import type { ReplyGuardPage, ReplyLeaseInput } from "../types";
async function request<T>(url: string, options?: RequestInit) {
    try {
        return await inboxRequest<T>(url, {
            ...options,
            signal: AbortSignal.timeout(10000),
        });
    } catch (e) {
        if (["TimeoutError", "AbortError"].includes((e as Error).name))
            throw new Error(
                "답변 작성 권한 확인이 지연되고 있습니다. 초안을 유지하고 연결을 다시 확인해주세요.",
            );
        throw e;
    }
}
export const loadReplyGuard = (url: string) => request<ReplyGuardPage>(url);
export const writeReplyLease = (input: ReplyLeaseInput) =>
    request<ReplyGuardPage>("/api/inbox-reply-guard", {
        method: "POST",
        body: JSON.stringify(input),
    });
export const saveReplyGuard = (input: {
    channelId: number;
    version: number;
    enabled: boolean;
}) => inboxWrite<ReplyGuardPage>("/api/inbox-reply-guard", input, "PATCH");
