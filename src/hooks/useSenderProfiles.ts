import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface SenderProfile {
    id: number;
    orgId: string;
    name: string;
    fromName: string;
    fromEmail: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}


export function useSenderProfiles() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: SenderProfile[] }>(
        "/api/email/sender-profiles",
        defaultFetcher
    );

    const createProfile = async (profile: { name: string; fromName: string; fromEmail: string }) => {
        const res = await fetch("/api/email/sender-profiles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(profile),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateProfile = async (id: number, profile: Partial<{ name: string; fromName: string; fromEmail: string; isDefault: boolean }>) => {
        const res = await fetch(`/api/email/sender-profiles/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(profile),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteProfile = async (id: number) => {
        const res = await fetch(`/api/email/sender-profiles/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const profiles = data?.data ?? [];

    return {
        profiles,
        defaultProfile: profiles.find((p) => p.isDefault) ?? profiles[0] ?? null,
        isLoading,
        error,
        mutate,
        createProfile,
        updateProfile,
        deleteProfile,
    };
}
