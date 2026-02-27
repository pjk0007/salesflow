import useSWR from "swr";

interface EmailConfigData {
    id: number;
    appKey: string;
    secretKey: string;
    fromName: string | null;
    fromEmail: string | null;
    isActive: number;
}

interface ConfigResponse {
    success: boolean;
    data: EmailConfigData | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useEmailConfig() {
    const { data, error, isLoading, mutate } = useSWR<ConfigResponse>(
        "/api/email/config",
        fetcher
    );

    const saveConfig = async (config: { appKey: string; secretKey: string; fromName?: string; fromEmail?: string }) => {
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
