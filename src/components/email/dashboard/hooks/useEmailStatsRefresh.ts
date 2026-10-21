import { useState } from "react";
import { useSWRConfig } from "swr";
import { useSession } from "@/contexts/SessionContext";
import { refreshStats, STATS_URL } from "../api/emailStatsApi";

export function useEmailStatsRefresh() {
    const { user } = useSession();
    const { mutate } = useSWRConfig();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [message, setMessage] = useState("");
    const handleRefresh = async () => {
        if (isRefreshing)
            return;
        setIsRefreshing(true);
        setMessage("");
        try {
            const result = await refreshStats();
            setMessage(result.running ? "집계 중입니다, 잠시 뒤 반영됩니다" : "갱신했습니다.");
            if (!result.running)
                await mutate(key => typeof key === "string" && key.startsWith(`${STATS_URL}?`));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "이메일 통계를 갱신하지 못했습니다.");
        } finally {
            setIsRefreshing(false);
        }
    };
    return {
        canRefresh: !!user && user.role !== "member",
        isRefreshing,
        message,
        handleRefresh
    };
}
