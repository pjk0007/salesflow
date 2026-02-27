import useSWR from "swr";

interface AlimtalkConfigData {
    id: number;
    appKey: string;
    secretKey: string;
    defaultSenderKey: string | null;
    isActive: number;
}

interface ConfigResponse {
    success: boolean;
    data: AlimtalkConfigData | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAlimtalkConfig() {
    const { data, error, isLoading, mutate } = useSWR<ConfigResponse>(
        "/api/alimtalk/config",
        fetcher
    );

    const saveConfig = async (config: { appKey: string; secretKey: string }) => {
        const res = await fetch("/api/alimtalk/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const testConnection = async (config: { appKey: string; secretKey: string }) => {
        const res = await fetch("/api/alimtalk/config/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
        });
        return res.json();
    };

    const setDefaultSender = async (senderKey: string) => {
        const res = await fetch("/api/alimtalk/config/default-sender", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ senderKey }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        config: data?.data ?? null,
        isConfigured: !!data?.data?.appKey,
        isLoading,
        error,
        mutate,
        saveConfig,
        testConnection,
        setDefaultSender,
    };
}
