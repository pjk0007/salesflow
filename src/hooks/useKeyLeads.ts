import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface KeyLead {
    id: number;
    recordId: number | null;
    email: string | null;
    name: string | null;
    totalVisits: number;
    lastSeenAt: string;
    totalDurationSec: number;
    clickCount: number;
}

interface KeyLeadsData {
    criteria: { minVisits: number; minDurationSec: number; minClicks: number };
    leads: KeyLead[];
}

export function useKeyLeads(opts?: { minVisits?: number; minDurationSec?: number; minClicks?: number }) {
    const qs = new URLSearchParams();
    if (opts?.minVisits) qs.set("minVisits", String(opts.minVisits));
    if (opts?.minDurationSec) qs.set("minDurationSec", String(opts.minDurationSec));
    if (opts?.minClicks) qs.set("minClicks", String(opts.minClicks));
    const key = `/api/analytics/key-leads${qs.toString() ? `?${qs}` : ""}`;

    const { data, isLoading } = useSWR<{ success: boolean; data?: KeyLeadsData }>(key, defaultFetcher);
    return {
        leads: data?.data?.leads ?? [],
        criteria: data?.data?.criteria ?? null,
        isLoading,
    };
}
