import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface MemoAttachmentItem {
    url: string;
    name: string;
    type: string;
    size: number;
}

export interface MemoItem {
    id: number;
    content: string;
    createdAt: string;
    createdBy: string | null;
    userName: string | null;
    /** 리드 댓글 종류 call|mail|meeting|sms|etc (없으면 일반 메모) */
    kind?: string | null;
    attachments?: MemoAttachmentItem[] | null;
    nextContactAt?: string | null;
}

export interface NewMemoInput {
    content: string;
    kind?: string | null;
    attachments?: MemoAttachmentItem[];
    nextContactAt?: string | null;
}

interface MemosResponse {
    success: boolean;
    data: MemoItem[];
}

export function useMemos(recordId: number | null) {
    const url = recordId ? `/api/records/${recordId}/memos` : null;

    const { data, error, isLoading, mutate } = useSWR<MemosResponse>(
        url,
        defaultFetcher
    );

    const addMemo = async (input: string | NewMemoInput) => {
        const body = typeof input === "string" ? { content: input } : input;
        const res = await fetch(`/api/records/${recordId}/memos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        mutate();
        return json.data;
    };

    const deleteMemo = async (memoId: number) => {
        const res = await fetch(`/api/records/${recordId}/memos/${memoId}`, {
            method: "DELETE",
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        mutate();
    };

    const updateMemo = async (memoId: number, content: string) => {
        const res = await fetch(`/api/records/${recordId}/memos/${memoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        mutate();
    };

    return {
        memos: data?.data || [],
        error,
        isLoading,
        mutate,
        addMemo,
        updateMemo,
        deleteMemo,
    };
}
