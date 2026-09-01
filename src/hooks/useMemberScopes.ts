import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

export type MemberScopeType = "workspace" | "folder" | "partition";

export interface ScopePermissions {
    read: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
}

export interface MemberScopeItem {
    id: number;
    userId: string;
    userName: string;
    userEmail: string;
    scopeType: string;
    scopeId: number;
    scopeName: string;
    permissions: ScopePermissions;
    createdAt: string;
}

export interface GrantScopeInput {
    scopeType: MemberScopeType;
    scopeId: number;
    permissions: ScopePermissions;
}

export function useMemberScopes(userId?: string) {
    const key = userId ? `/api/member-scopes?userId=${userId}` : "/api/member-scopes";
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: MemberScopeItem[] }>(
        key,
        defaultFetcher
    );

    const grantScopes = async (targetUserId: string, scopes: GrantScopeInput[]) => {
        const res = await fetch("/api/member-scopes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: targetUserId, scopes }),
        });
        const result = await res.json();
        // 권한은 틀린 화면을 잠깐이라도 보여주면 안 되므로 낙관적 업데이트 없이 재검증한다
        if (result.success) await mutate();
        return result;
    };

    const updateScope = async (id: number, permissions: ScopePermissions) => {
        const res = await fetch(`/api/member-scopes/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permissions }),
        });
        const result = await res.json();
        if (result.success) await mutate();
        return result;
    };

    const revokeScope = async (id: number) => {
        const res = await fetch(`/api/member-scopes/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) await mutate();
        return result;
    };

    return {
        scopes: data?.data ?? [],
        isLoading,
        error,
        grantScopes,
        updateScope,
        revokeScope,
        mutate,
    };
}
