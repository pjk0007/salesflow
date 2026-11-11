import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface SalesCompany {
    name: string;
    count: number;
    address: string;
    workspaceIds: number[];
}

/** 영업 리드 기업 목록 (같은 기업 이름 규칙으로 묶은 대표 이름·인원·주소·사업부) */
export function useSalesCompanies() {
    const { data, mutate } = useSWR<{ success: boolean; data: SalesCompany[] }>("/api/sales/companies", defaultFetcher);
    return { companies: data?.data ?? [], mutate };
}
