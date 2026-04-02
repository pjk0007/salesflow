import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface MemoItem {
    id: number;
    content: string;
    createdAt: string;
    createdBy: string | null;
    userName: string | null;
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

    const addMemo = async (content: string) => {
        const res = await fetch(`/api/records/${recordId}/memos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
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

    return {
        memos: data?.data || [],
        error,
        isLoading,
        mutate,
        addMemo,
        deleteMemo,
    };
}
