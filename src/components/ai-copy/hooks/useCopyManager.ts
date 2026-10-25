"use client";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { copyRequest } from "../api/copy";
import type { CopyCatalog, CopyPurpose, KnowledgeVersion } from "../types";

export function useCopyManager(enabled = true) {
    const [cursor, setCursor] = useState(0),
        [knowledgeCursor, setKnowledgeCursor] = useState(0);
    // 쪽 이동 중에도 이전 쪽을 유지해 화면 전체가 '불러오는 중'으로 바뀌지 않게 한다(UX-302).
    const catalog = useSWR<CopyCatalog>(
        enabled ? `/api/ai/copy-policies?cursor=${cursor}` : null,
        copyRequest,
        { keepPreviousData: true },
    );
    const knowledge = useSWR<{ versions: KnowledgeVersion[]; nextCursor: number | null }>(
        enabled ? `/api/ai/knowledge-versions?cursor=${knowledgeCursor}` : null,
        copyRequest,
        { keepPreviousData: true },
    );
    const { mutate } = useSWRConfig();
    const [pending, setPending] = useState(false),
        [actionError, setActionError] = useState<string | null>(null);
    /**
     * success: 성공 토스트 문구(동작별 안내). rethrow: 확인창 안에서 부를 때 오류를 던져 확인창이 열린 채 표시하게 한다.
     */
    async function act<T>(
        url: string,
        body: unknown,
        options: { success?: string | ((data: T) => string); rethrow?: boolean } = {},
    ): Promise<T | undefined> {
        setPending(true);
        setActionError(null);
        try {
            const data = await copyRequest<T>(url, body);
            await mutate(
                (key) =>
                    typeof key === "string" &&
                    (key.startsWith("/api/ai/") || key.startsWith("/api/email/experiments")),
            );
            toast.success(
                typeof options.success === "function"
                    ? options.success(data)
                    : (options.success ?? "저장했습니다."),
            );
            return data;
        } catch (error) {
            if (options.rethrow) throw error;
            const message = error instanceof Error ? error.message : "처리하지 못했습니다.";
            setActionError(message);
            toast.error(message);
        } finally {
            setPending(false);
        }
    }
    return {
        catalog: catalog.data,
        knowledge: knowledge.data,
        // 첫 조회만 화면 전체를 막는다. 쪽 이동 중·쪽 오류는 각 탭 안에서 보여 준다.
        loading: (!catalog.data && catalog.isLoading) || (!knowledge.data && knowledge.isLoading),
        error: (!catalog.data && catalog.error) || (!knowledge.data && knowledge.error) || null,
        retry: () => {
            void catalog.mutate();
            void knowledge.mutate();
        },
        catalogPage: { validating: catalog.isValidating, error: catalog.data ? catalog.error : null, retry: () => void catalog.mutate() },
        knowledgePage: { validating: knowledge.isValidating, error: knowledge.data ? knowledge.error : null, retry: () => void knowledge.mutate() },
        pending,
        actionError,
        // 대화상자를 닫거나 탭을 옮기면 그 작업의 오류를 페이지에 남기지 않는다.
        clearActionError: () => setActionError(null),
        act,
        cursor,
        setCursor,
        knowledgeCursor,
        setKnowledgeCursor,
    };
}

/**
 * 선택기 전용 버전 조회(UX-167). 관리 목록의 50개 쪽과 분리해 조건에 맞는 버전만 커서로 이어 받는다.
 * state: approved = 승인만, usable = 차단·사용 종료 제외.
 */
export function useVersionOptions<T extends { id: number }>(
    kind: "policy" | "knowledge",
    filter: { workspaceId: number; state: "approved" | "usable"; purpose?: CopyPurpose },
) {
    const base = kind === "policy" ? "/api/ai/copy-policies" : "/api/ai/knowledge-versions";
    const query = `workspaceId=${filter.workspaceId}&state=${filter.state}${
        kind === "policy" && filter.purpose ? `&purpose=${filter.purpose}` : ""
    }`;
    const pages = useSWRInfinite<{ versions: T[]; nextCursor: number | null }>(
        (index, previous) =>
            !filter.workspaceId || (previous && !previous.nextCursor)
                ? null
                : `${base}?${query}&cursor=${index ? previous!.nextCursor : 0}`,
        copyRequest,
    );
    return {
        versions: pages.data?.flatMap((page) => page.versions) ?? [],
        hasMore: !!pages.data?.at(-1)?.nextCursor,
        loadMore: () => void pages.setSize((size) => size + 1),
        loading: pages.isLoading || pages.isValidating,
        error: pages.error as unknown,
        retry: () => void pages.mutate(),
    };
}
