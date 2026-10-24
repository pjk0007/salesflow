"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { RepliesResponse, ReplyFilters, ReplyPatch } from "../types";
import { patchReply, repliesKey } from "../api/replies";

/**
 * 회신 목록 + 연결 상태(meta.sync). 회신 탭·레코드 상세가 쓴다.
 * enabled=false면 요청하지 않는다 (레코드 상세에서 레코드가 없을 때)
 */
export function useReplies(filters: ReplyFilters, enabled: boolean = true) {
    const { data, error, isLoading, mutate } = useSWR<RepliesResponse>(enabled ? repliesKey(filters) : null, defaultFetcher, {
        // 회신은 5분마다 들어온다 — 탭을 열어 두면 1분마다 새로 본다
        refreshInterval: 60_000,
    });

    const update = async (id: number, body: ReplyPatch) => {
        const result = await patchReply(id, body);
        await mutate();
        return result;
    };

    return {
        items: data?.success ? data.data ?? [] : [],
        totalCount: data?.totalCount ?? 0,
        sync: data?.meta?.sync ?? null,
        isAdmin: data?.meta?.isAdmin ?? false,
        candidates: data?.meta?.candidates ?? [],
        loadFailed: !!error || (data !== undefined && !data.success),
        isLoading,
        error,
        mutate,
        update,
    };
}
