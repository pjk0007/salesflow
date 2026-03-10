import useSWR from "swr";
import type { ApiResponse, MemberItem, OrgRole } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";


export function useOrgMembers() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<MemberItem[]>>(
        "/api/org/members",
        defaultFetcher
    );

    const updateRole = async (userId: string, role: OrgRole) => {
        const res = await fetch(`/api/org/members/${userId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const removeMember = async (userId: string) => {
        const res = await fetch(`/api/org/members/${userId}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        members: data?.data ?? [],
        isLoading,
        error,
        mutate,
        updateRole,
        removeMember,
    };
}
