"use client";

import { useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { SENDER_PROFILES_KEY, SEND_QUEUE_STATS_KEY } from "@/components/email/sender-profiles/api/senderProfiles";
import { SEND_HEALTH_HOLDS_KEY, SEND_HEALTH_KEY, releaseHold, releaseSender } from "../api/sendHealthApi";
import type { ApiResult, PartitionHoldRow, SendHealthView, SenderHealthRow } from "../types";

/**
 * 발신 건강 화면 데이터 (GET /api/email/send-health). 배지·띠 표시용이라 실패하면 빈 값으로 둔다 —
 * 건강 정보를 못 읽었다고 규칙 목록·발신 주소 목록을 막지 않는다. 같은 키라 한 화면에서 요청은 한 번만 나간다.
 * 풀기 뒤에는 건강·보류·발신 주소·대기열 통계를 함께 새로 고친다.
 */
export function useSendHealth(enabled: boolean = true) {
    const { data, error, isLoading, mutate } = useSWR<ApiResult<SendHealthView>>(enabled ? SEND_HEALTH_KEY : null, defaultFetcher, {
        refreshInterval: 5 * 60 * 1000,
    });
    const { mutate: globalMutate } = useSWRConfig();
    const view = data?.success ? data.data ?? null : null;

    const holdByPartition = useMemo(() => new Map<number, PartitionHoldRow>((view?.holds ?? []).map((h) => [h.partitionId, h])), [view]);
    const senderById = useMemo(() => new Map<number, SenderHealthRow>((view?.senders ?? []).map((s) => [s.profileId, s])), [view]);

    const refreshAll = async () => {
        await Promise.all([mutate(), globalMutate(SEND_HEALTH_HOLDS_KEY), globalMutate(SENDER_PROFILES_KEY), globalMutate(SEND_QUEUE_STATS_KEY)]);
    };

    return {
        error: error,
        view,
        holdByPartition,
        senderById,
        loaded: view !== null,
        loadFailed: !!error || (data !== undefined && !data.success),
        isLoading,
        mutate,
        releaseHold: async (holdId: number, note: string) => {
            const r = await releaseHold(holdId, note);
            if (r.success) await refreshAll();
            return r;
        },
        releaseSender: async (profileId: number, note: string) => {
            const r = await releaseSender(profileId, note);
            if (r.success) await refreshAll();
            return r;
        },
    };
}

/** 보류 중인 명단만 (명단 목록의 빨간 점·레코드 화면 머리 띠 — 가볍게 읽는다) */
export function usePartitionHolds(enabled: boolean = true) {
    const { data, mutate , error: queryError0 } = useSWR<ApiResult<{ holds: PartitionHoldRow[]; isAdmin: boolean }>>(
        enabled ? SEND_HEALTH_HOLDS_KEY : null,
        defaultFetcher,
        { refreshInterval: 5 * 60 * 1000 }
    );
    const { mutate: globalMutate } = useSWRConfig();
    const holds = useMemo(() => (data?.success ? data.data?.holds ?? [] : []), [data]);
    const byPartition = useMemo(() => new Map(holds.map((h) => [h.partitionId, h])), [holds]);
    return {
        error: queryError0,
        mutate: mutate,
        holds,
        byPartition,
        isAdmin: data?.success ? !!data.data?.isAdmin : false,
        releaseHold: async (holdId: number, note: string) => {
            const r = await releaseHold(holdId, note);
            if (r.success) await Promise.all([mutate(), globalMutate(SEND_HEALTH_KEY), globalMutate(SEND_QUEUE_STATS_KEY)]);
            return r;
        },
    };
}
