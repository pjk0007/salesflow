import useSWR from "swr";
import type { CompareData, StatsQuery } from "@/components/email/dashboard/types";
import { fetchStats, statsUrl, STATS_SWR } from "@/components/email/dashboard/api/emailStatsApi";

export interface CampaignOption {
    key: string;
    label: string;
    sublabel: string | null;
    sent: number;
}

/** 이 사업부·기간에 보낸 메일 목록 (발송 많은 순) — 메일 고르기 */
export function useCampaignOptions(base: StatsQuery) {
    const { data, isLoading } = useSWR<CompareData>(statsUrl("compare", { ...base, campaign: null }, "campaign"), fetchStats, STATS_SWR);
    const options: CampaignOption[] = (data?.rows ?? [])
        .filter((r) => r.key !== "__rest" && r.counts.accepted > 0)
        .map((r) => ({
            key: r.key,
            label: r.label,
            sublabel: r.sublabel,
            sent: r.counts.accepted,
        }));
    return {
        options,
        isLoading,
        nameOf: (key: string | null) => options.find((o) => o.key === key)?.label ?? null,
    };
}
