"use client";

import useSWR from "swr";
import { mutate as globalMutate } from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type {
    EventAliasListResponse,
    EventAliasMutateResponse,
    EventAliasDeleteResponse,
    EventAliasType,
} from "../types/event-alias";

export function useEventAliases(
    siteId: number | null,
    params: { type?: EventAliasType | null; q?: string; page?: number } = {},
) {
    const key = siteId
        ? `/api/tracker/event-aliases?` + new URLSearchParams({
            siteId: String(siteId),
            ...(params.type ? { type: params.type } : {}),
            ...(params.q ? { q: params.q } : {}),
            ...(params.page && params.page > 1 ? { page: String(params.page) } : {}),
        }).toString()
        : null;
    const { data, isLoading, error, mutate } = useSWR<EventAliasListResponse>(key, defaultFetcher, { keepPreviousData: true });
    const list = data?.success ? data : null;
    return {
        data: list?.data ?? [],
        total: list?.total ?? 0,
        page: list?.page ?? 1,
        totalPages: list?.totalPages ?? 0,
        isLoading,
        error: data && !data.success ? data.error : (error?.message ?? null),
        mutate,
    };
}

/** 라벨 변경 후 분석 화면(engagement)도 함께 무효화. */
function invalidateEngagement() {
    globalMutate(
        (k) => typeof k === "string" && k.startsWith("/api/tracker/analytics/engagement"),
        undefined,
        { revalidate: true },
    );
}

export async function createEventAlias(payload: {
    siteId: number;
    eventType: "SECTION_VIEW" | "CLICK" | "CUSTOM";
    eventName: string;
    label: string;
}) {
    const res = await fetch("/api/tracker/event-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const json = (await res.json()) as EventAliasMutateResponse;
    if (!json.success) throw new Error(json.error);
    invalidateEngagement();
    return json.data;
}

export async function updateEventAlias(id: number, label: string) {
    const res = await fetch(`/api/tracker/event-aliases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
    });
    const json = (await res.json()) as EventAliasMutateResponse;
    if (!json.success) throw new Error(json.error);
    invalidateEngagement();
    return json.data;
}

export async function deleteEventAlias(id: number) {
    const res = await fetch(`/api/tracker/event-aliases/${id}`, { method: "DELETE" });
    const json = (await res.json()) as EventAliasDeleteResponse;
    if (!json.success) throw new Error(json.error);
    invalidateEngagement();
}
