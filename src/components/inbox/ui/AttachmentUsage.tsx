"use client";
import useSWR from "swr";
import { inboxRequest } from "../api";
import { attachmentUsageText } from "../utils/attachment-usage";
/** 상담창 첨부 저장 사용량. 한도에 닿으면 고객·직원 모두 첨부가 막히므로 미리 보여준다. */
export function AttachmentUsage({ channelId }: { channelId: number }) {
    const { data, error } = useSWR<{ usedBytes: number; quotaBytes: number }>(
        `/api/inbox/channels/${channelId}/attachment-usage`,
        inboxRequest,
    );
    if (error)
        return <p className="mb-5 text-xs text-muted-foreground">첨부 저장 사용량을 확인하지 못했습니다.</p>;
    if (!data) return null;
    const usage = attachmentUsageText(data.usedBytes, data.quotaBytes);
    return (
        <p className={`mb-5 text-xs ${usage.warn ? "text-amber-800" : "text-muted-foreground"}`}>
            {usage.text}
        </p>
    );
}
