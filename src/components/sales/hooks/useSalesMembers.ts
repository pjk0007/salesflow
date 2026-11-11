import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { SalesMember } from "../types";

/** 담당자 고르기용 팀원 목록 */
export function useSalesMembers() {
    const { data } = useSWR<{ success: boolean; data: SalesMember[] }>("/api/sales/members", defaultFetcher);
    const members = data?.data ?? [];
    return { members, nameOf: (id: string | null | undefined) => members.find((m) => m.id === id)?.name ?? null };
}
