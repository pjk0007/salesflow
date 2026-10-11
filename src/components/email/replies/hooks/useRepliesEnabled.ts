"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
import type { RepliesStatusResponse } from "../types";
import { REPLIES_STATUS_KEY } from "../api/replies";

/**
 * 이 조직에 회신 탭을 보일지 (회신 읽기 대상 조직만 — RH-SEC-5·OPS-6). 응답 전·실패면 false (탭을 숨긴다)
 */
export function useRepliesEnabled(): boolean {
    const { data } = useSWR<RepliesStatusResponse>(REPLIES_STATUS_KEY, defaultFetcher, { revalidateOnFocus: false });
    return data?.success === true && data.data?.enabled === true;
}
