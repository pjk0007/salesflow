"use client";
import useSWRInfinite from "swr/infinite";
import { isUsableSupportClaim } from "@/lib/customer-ai/knowledge-validity";
import { supportRequest } from "../api";
import type { SupportKnowledge } from "../types";

/**
 * 설정 선택기용 이전 승인 지식(UX-301). 최신 100개 밖의 승인·상담 목적 버전을 이름 검색과 커서로 이어 받는다.
 * 열었을 때만 조회한다.
 */
export function useApprovedKnowledge(workspaceId: number, q: string, open: boolean) {
    const query = `workspaceId=${workspaceId}&state=approved${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;
    const pages = useSWRInfinite<{ rows: SupportKnowledge[]; hasMore: boolean }>(
        (index, previous) =>
            !open || (previous && !previous.hasMore)
                ? null
                : `/api/customer-ai/knowledge?${query}${index ? `&before=${previous!.rows.at(-1)!.id}` : ""}`,
        supportRequest,
    );
    return {
        options: (pages.data ?? []).flatMap((page) =>
            page.rows.map((k) => ({
                id: k.id,
                name: k.name,
                state: k.state,
                claims: k.snapshot.claims.filter((c) => isUsableSupportClaim(c)).length,
            })),
        ),
        hasMore: !!pages.data?.at(-1)?.hasMore,
        loadMore: () => void pages.setSize((size) => size + 1),
        loading: pages.isLoading || pages.isValidating,
        error: pages.error as Error | undefined,
        retry: () => void pages.mutate(),
    };
}
