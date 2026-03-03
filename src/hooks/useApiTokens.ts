import useSWR from "swr";

interface ApiTokenScope {
    id: number;
    scopeType: string;
    scopeId: number;
    scopeName?: string;
    permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
}

interface ApiTokenWithScopes {
    id: number;
    name: string;
    tokenPreview: string;
    scopes: ApiTokenScope[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    isActive: number;
    createdAt: string;
}

interface CreateTokenInput {
    name: string;
    expiresIn: "30d" | "90d" | "1y" | null;
    scopes: Array<{
        scopeType: "workspace" | "folder" | "partition";
        scopeId: number;
        permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
    }>;
}

interface UpdateTokenInput {
    name?: string;
    isActive?: number;
    scopes?: CreateTokenInput["scopes"];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useApiTokens() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: ApiTokenWithScopes[] }>(
        "/api/api-tokens",
        fetcher
    );

    const createToken = async (input: CreateTokenInput) => {
        const res = await fetch("/api/api-tokens", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateToken = async (id: number, input: UpdateTokenInput) => {
        const res = await fetch(`/api/api-tokens/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteToken = async (id: number) => {
        const res = await fetch(`/api/api-tokens/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        tokens: data?.data ?? [],
        isLoading,
        error,
        createToken,
        updateToken,
        deleteToken,
    };
}
