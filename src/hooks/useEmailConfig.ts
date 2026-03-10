import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface EmailConfigData {
    id: number;
    appKey: string;
    secretKey: string;
    fromName: string | null;
    fromEmail: string | null;
    signature: string | null;
    signatureEnabled: boolean;
    isActive: number;
}

interface ConfigResponse {
    success: boolean;
    data: EmailConfigData | null;
}


export function useEmailConfig() {
    const { data, error, isLoading, mutate } = useSWR<ConfigResponse>(
        "/api/email/config",
        defaultFetcher
    );

    const saveConfig = async (config: { appKey: string; secretKey: string; fromName?: string; fromEmail?: string; signature?: string; signatureEnabled?: boolean }) => {
        const res = await fetch("/api/email/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const testConnection = async (config: { appKey: string; secretKey: string }) => {
        const res = await fetch("/api/email/config/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        return res.json();
    };

    return {
        config: data?.data ?? null,
        isConfigured: !!data?.data?.appKey,
        isLoading,
        error,
        mutate,
        saveConfig,
        testConnection,
    };
}
