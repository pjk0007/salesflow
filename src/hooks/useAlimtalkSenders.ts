import useSWR from "swr";
import { useAlimtalkConfig } from "./useAlimtalkConfig";
import type { NhnSenderProfile } from "@/lib/nhn-alimtalk";

interface SendersResponse {
    success: boolean;
    data?: {
        senders: NhnSenderProfile[];
        totalCount: number;
    };
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkSenders() {
    const { isConfigured } = useAlimtalkConfig();

    const { data, error, isLoading, mutate } = useSWR<SendersResponse>(
        isConfigured ? "/api/alimtalk/senders" : null,
        fetcher
    );

    const registerSender = async (senderData: {
        plusFriendId: string;
        phoneNo: string;
        categoryCode: string;
    }) => {
        const res = await fetch("/api/alimtalk/senders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(senderData),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const authenticateToken = async (data: {
        plusFriendId: string;
        token: string;
    }) => {
        const res = await fetch("/api/alimtalk/senders/token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteSender = async (senderKey: string) => {
        const res = await fetch(`/api/alimtalk/senders/${encodeURIComponent(senderKey)}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        senders: data?.data?.senders ?? [],
        totalCount: data?.data?.totalCount ?? 0,
        isLoading,
        error,
        mutate,
        registerSender,
        authenticateToken,
        deleteSender,
    };
}
