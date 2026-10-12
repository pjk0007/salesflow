"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { ApiResult, SendQueueRuleStats, SendQueueStats } from "../types";
import { SEND_QUEUE_STATS_KEY } from "../api/senderProfiles";

/**
 * 규칙별 대기 통계. 배지·경고 표시용이라 실패하면 빈 값으로 둔다 — 통계를 못 읽었다고 규칙 목록이나 저장을 막지 않는다.
 * 규칙 목록·규칙 화면·대시보드가 같은 키를 쓰므로 한 화면에서 요청은 한 번만 나간다.
 */
export function useSendQueueStats(enabled: boolean = true) {
    const { data, error, isLoading, mutate } = useSWR<ApiResult<SendQueueStats>>(
        enabled ? SEND_QUEUE_STATS_KEY : null,
        defaultFetcher
    );

    const stats = data?.success ? data.data ?? null : null;
    const byLinkId = useMemo(
        () => new Map<number, SendQueueRuleStats>((stats?.rules ?? []).map((r) => [r.linkId, r])),
        [stats]
    );

    return {
        stats,
        byLinkId,
        /** 통계를 읽었는가. 못 읽었으면 "대기 없음"으로 보이지 않게 가린다 */
        loaded: stats !== null,
        loadFailed: !!error || (data !== undefined && !data.success),
        isLoading,
        mutate,
    };
}
