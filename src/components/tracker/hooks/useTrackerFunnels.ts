"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { FunnelDefinition, FunnelsListResponse, FunnelMutateResponse } from "../types/funnel";

export function useTrackerFunnels(siteId: number | null) {
    const key = siteId ? `/api/tracker/funnels?siteId=${siteId}` : null;
    const { data, isLoading, error, mutate } = useSWR<FunnelsListResponse>(key, defaultFetcher);
    return {
        funnels: data?.success ? data.data : [],
        isLoading,
        error: data && !data.success ? data.error : (error?.message ?? null),
        mutate,
    };
}

async function postJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return (await res.json()) as T;
}

export async function createFunnel(input: {
    siteId: number; name: string;
    stages: FunnelDefinition["stages"];
    isDefault?: boolean;
}): Promise<FunnelDefinition> {
    const json = await postJson<FunnelMutateResponse>(`/api/tracker/funnels`, input, "POST");
    if (!json.success) throw new Error(json.error);
    return json.data;
}

export async function updateFunnel(id: number, input: {
    name?: string;
    stages?: FunnelDefinition["stages"];
    isDefault?: boolean;
}): Promise<FunnelDefinition> {
    const json = await postJson<FunnelMutateResponse>(`/api/tracker/funnels/${id}`, input, "PATCH");
    if (!json.success) throw new Error(json.error);
    return json.data;
}

export async function deleteFunnel(id: number): Promise<void> {
    const res = await fetch(`/api/tracker/funnels/${id}`, { method: "DELETE" });
    const json: { success: boolean; error?: string } = await res.json();
    if (!json.success) throw new Error(json.error ?? "삭제 실패");
}
