"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { ReplyStatsResponse, RuleReplyCounts } from "../types";
import { REPLY_STATS_KEY } from "../api/replies";

/**
 * 규칙별 28일 회신 수 (AI 규칙 카드·템플릿 자동발송 목록 배지). 한 번 불러 규칙 번호로 찾는다.
 * 배지용이라 실패하면 아무것도 보이지 않는다 — 회신 수를 못 읽었다고 규칙 화면을 막지 않는다.
 */
export function useReplyStats() {
    const { data , error: queryError0, mutate: retryQuery0 } = useSWR<ReplyStatsResponse>(REPLY_STATS_KEY, defaultFetcher);
    const stats = data?.success ? data.data ?? null : null;
    return {
        error: queryError0,
        mutate: retryQuery0,
        days: stats?.days ?? 28,
        countsFor: (kind: "ai" | "template", ruleId: number): RuleReplyCounts | null => stats?.byRule[`${kind}:${ruleId}`] ?? null,
        loaded: stats !== null,
    };
}
