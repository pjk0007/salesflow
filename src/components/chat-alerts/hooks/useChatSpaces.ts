import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { ApiResponse } from "@/types";
import { CHAT_SPACES_URL, createChatSpace, deleteChatSpace, updateChatSpace } from "../api";
import type { ChatSpaceInput, ChatSpaceItem } from "../types";

/** 조직의 구글챗 스페이스 목록. enabled=false면 불러오지 않는다 (관리자가 아닐 때) */
export function useChatSpaces(enabled = true) {
    const { data, isLoading, mutate } = useSWR<ApiResponse<ChatSpaceItem[]>>(
        enabled ? CHAT_SPACES_URL : null,
        defaultFetcher
    );

    const withRefresh = async <R extends { success: boolean }>(p: Promise<R>) => {
        const result = await p;
        if (result.success) mutate();
        return result;
    };

    return {
        spaces: data?.data ?? [],
        isLoading,
        create: (input: ChatSpaceInput) => withRefresh(createChatSpace(input)),
        update: (id: number, input: ChatSpaceInput) => withRefresh(updateChatSpace(id, input)),
        remove: (id: number) => withRefresh(deleteChatSpace(id)),
    };
}
