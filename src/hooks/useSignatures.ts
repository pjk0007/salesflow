import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface EmailSignatureData {
    id: number;
    orgId: string;
    name: string;
    signature: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
}


export function useSignatures() {
    const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: EmailSignatureData[] }>(
        "/api/email/signatures",
        defaultFetcher
    );

    const createSignature = async (sig: { name: string; signature: string }) => {
        const res = await fetch("/api/email/signatures", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sig),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const updateSignature = async (id: number, sig: Partial<{ name: string; signature: string; isDefault: boolean }>) => {
        const res = await fetch(`/api/email/signatures/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sig),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteSignature = async (id: number) => {
        const res = await fetch(`/api/email/signatures/${id}`, {
            method: "DELETE",
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const signatures = data?.data ?? [];

    return {
        signatures,
        defaultSignature: signatures.find((s) => s.isDefault) ?? signatures[0] ?? null,
        isLoading,
        error,
        mutate,
        createSignature,
        updateSignature,
        deleteSignature,
    };
}
