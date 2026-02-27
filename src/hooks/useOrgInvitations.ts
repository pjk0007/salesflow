import useSWR from "swr";
import type { ApiResponse, InvitationItem, OrgRole } from "@/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function useOrgInvitations() {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<InvitationItem[]>>(
        "/api/org/invitations",
        fetcher
    );

    const createInvitation = async (email: string, role: OrgRole) => {
        const res = await fetch("/api/org/invitations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, role }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const cancelInvitation = async (id: number) => {
        const res = await fetch(`/api/org/invitations/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        invitations: data?.data ?? [],
        isLoading,
        error,
        mutate,
        createInvitation,
        cancelInvitation,
    };
}
