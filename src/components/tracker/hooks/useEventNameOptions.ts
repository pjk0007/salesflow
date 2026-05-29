"use client";

import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export interface EventNameOption {
    eventType: "SECTION_VIEW" | "CLICK";
    eventName: string;
    occurrences: number;
}

type EventNameOptionsResponse =
    | { success: true; data: EventNameOption[] }
    | { success: false; error: string };

/**
 * 사이트에서 실제 발생한 (event_type, event_name) 목록.
 * 별칭 등록 다이얼로그의 자동완성 옵션 제공.
 */
export function useEventNameOptions(siteId: number) {
    const key = `/api/tracker/sites/${siteId}/event-name-options`;
    const { data, isLoading } = useSWR<EventNameOptionsResponse>(key, defaultFetcher);
    return {
        data: data?.success ? data.data : [],
        isLoading,
    };
}
