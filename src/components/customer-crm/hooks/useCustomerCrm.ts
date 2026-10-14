"use client";
import useSWRInfinite from "swr/infinite";
import { crmRequest } from "../api";
import type { Resource } from "../types";
export function useCrmList<T extends { id: string }>(
    workspaceId: number | null,
    resource: Resource,
    query: Record<string, string> = {},
) {
    const pages = useSWRInfinite<T[]>(
        (index, previous: T[] | null) => {
            if (!workspaceId || (index > 0 && previous?.length !== 100))
                return null;
            const params = new URLSearchParams({
                workspaceId: String(workspaceId),
                ...query,
            });
            if (index && previous?.length)
                params.set("before", previous.at(-1)!.id);
            return `/api/customer-crm/${resource}?${params}`;
        },
        crmRequest,
        { refreshInterval: 15000, refreshWhenHidden: false },
    );
    return {
        ...pages,
        rows:
            pages.data
                ?.flat()
                .filter(
                    (row, index, rows) =>
                        rows.findIndex((r) => r.id === row.id) === index,
                ) ?? [],
        hasMore: pages.data?.at(-1)?.length === 100,
        loadingMore: !!pages.data && !pages.data[pages.size - 1],
        loadMore: () => pages.setSize(pages.size + 1),
    };
}
