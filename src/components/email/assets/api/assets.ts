import type { EmailAsset } from "../types";

interface ApiResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export async function uploadAsset(file: File): Promise<ApiResult<EmailAsset>> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/email/assets", { method: "POST", body: formData });
    return res.json();
}

export async function renameAsset(id: number, name: string): Promise<ApiResult<EmailAsset>> {
    const res = await fetch(`/api/email/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    return res.json();
}

export async function deleteAsset(id: number): Promise<ApiResult<never>> {
    const res = await fetch(`/api/email/assets/${id}`, { method: "DELETE" });
    return res.json();
}
