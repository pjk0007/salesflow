import useSWR from "swr";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";

interface TemplatesResponse {
    success: boolean;
    data?: {
        templates: NhnTemplate[];
        totalCount: number;
    };
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkTemplates(senderKey: string | null) {
    const { data, error, isLoading, mutate } = useSWR<TemplatesResponse>(
        senderKey ? `/api/alimtalk/templates?senderKey=${encodeURIComponent(senderKey)}` : null,
        fetcher
    );

    return {
        templates: data?.data?.templates ?? [],
        totalCount: data?.data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
    };
}
