"use client";

import useSWR from "swr";
import { mutate as globalMutate } from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type {
    EventAliasListResponse,
    EventAliasMutateResponse,
    EventAliasDeleteResponse,
} from "../types/event-alias";

export function useEventAliases(siteId: number | null) {
    const key = siteId ? `/api/tracker/event-aliases?siteId=${siteId}` : null;
    const { data, isLoading, error, mutate } = useSWR<EventAliasListResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : [],
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
    eventType: "SECTION_VIEW" | "CLICK";
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
