"use client";

import { useEffect, useState } from "react";
import useSWRInfinite from "swr/infinite";
import type { EsignDocument, EsignListPage, StaffEsignSummary } from "@/lib/esign/types";
import { esignApi } from "../api/client";

type ListKey = readonly [string, string, number, string, string];

/** 입력이 멈춘 뒤에만 서버 검색어로 쓴다. */
export function useDebouncedValue(value: string, delay = 300) {
    const [settled, setSettled] = useState(value);
    useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer); }, [value, delay]);
    return settled;
}

/** 서버 커서 페이지를 이어 붙인다. 검색어가 바뀌면 첫 페이지부터 다시 읽는다. */
function useCursorList<T>(scope: string, name: string, workspaceId: number, enabled: boolean, query: string, load: (cursor?: string) => Promise<EsignListPage<T>>, refreshInterval?: (pages?: EsignListPage<T>[]) => number) {
    const list = useSWRInfinite<EsignListPage<T>, Error, (index: number, previous: EsignListPage<T> | null) => ListKey | null>(
        (index, previous) => !enabled || (previous && !previous.nextCursor) ? null : [scope, name, workspaceId, query, index ? previous!.nextCursor! : ""],
        ([, , , , cursor]) => load(cursor || undefined),
        { refreshInterval, revalidateFirstPage: true },
    );
    const pages = list.data ?? [];
    return {
        items: pages.flatMap(page => page.items), total: pages[0]?.total ?? 0,
        hasMore: !!pages.at(-1)?.nextCursor, loadingMore: list.isValidating && list.size > pages.length,
        isLoading: list.isLoading, error: list.error, loadError: pages.length ? undefined : list.error,
        loadMore: () => list.setSize(size => size + 1), mutate: list.mutate,
    };
}

export function useEsignEnvelopes(scope: string, workspaceId: number, enabled: boolean, query: string) {
    return useCursorList<StaffEsignSummary>(scope, "envelopes", workspaceId, enabled, query, cursor => esignApi.envelopes(workspaceId, { q: query, cursor }),
        pages => pages?.some(page => page.items.some(item => item.envelope.state === "pending" || item.envelope.state === "finalizing")) ? 10000 : 0);
}

export function useEsignTemplates(scope: string, workspaceId: number, enabled: boolean, query: string) {
    return useCursorList<EsignDocument>(scope, "templates", workspaceId, enabled, query, cursor => esignApi.documents(workspaceId, { kind: "template", q: query, cursor }));
}
