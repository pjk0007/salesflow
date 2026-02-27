import useSWR from "swr";

interface AiConfigData {
    id: number;
    provider: string;
    apiKey: string; // masked
    model: string | null;
    isActive: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useAiConfig() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: AiConfigData | null }>(
        "/api/ai/config",
        fetcher
    );

    const saveConfig = async (input: { provider: string; apiKey: string; model?: string }) => {
        const res = await fetch("/api/ai/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const testConnection = async (input: { provider: string; apiKey: string }) => {
        const res = await fetch("/api/ai/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        return res.json();
    };

    return {
        config: data?.data ?? null,
        isLoading,
        error,
        mutate,
        saveConfig,
        testConnection,
    };
}
