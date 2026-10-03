"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { ApiResult, SenderUsageView } from "../types";
import { SENDER_USAGE_KEY } from "../api/senderProfiles";

/**
 * 주소별 오늘 사용량·한도. 배지 표시용이라 실패하면 빈 값으로 둔다 —
 * 사용량을 못 읽었다고 프로필 목록이나 규칙 저장을 막지 않는다.
 */
export function useSenderUsage(enabled: boolean = true) {
    const { data, isLoading, mutate } = useSWR<ApiResult<SenderUsageView[]>>(
        enabled ? SENDER_USAGE_KEY : null,
        defaultFetcher
    );

    const usageById = useMemo(() => {
        const rows = data?.success ? data.data ?? [] : [];
        return new Map(rows.map((u) => [u.profileId, u]));
    }, [data]);

    return { usageById, isLoading, mutate };
}
