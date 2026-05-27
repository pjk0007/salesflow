import type { TrackerSite } from "../types";

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string };

export async function fetchTrackerSite(workspaceId: number): Promise<TrackerSite | null> {
    const res = await fetch(`/api/tracker/sites?workspaceId=${workspaceId}`);
    const json: ApiResponse<TrackerSite | null> = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

export async function createTrackerSite(input: {
    workspaceId: number;
    name: string;
    domains: string[];
    matchField?: string | null;
}): Promise<TrackerSite> {
    const res = await fetch(`/api/tracker/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    const json: ApiResponse<TrackerSite> = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

export async function updateTrackerSite(
    id: number,
    input: {
        name?: string;
        domains?: string[];
        isActive?: 0 | 1;
        matchField?: string | null;
        excludePaths?: string[];
        conversionStage?: string | null;
    },
): Promise<TrackerSite> {
    const res = await fetch(`/api/tracker/sites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
    });
    const json: ApiResponse<TrackerSite> = await res.json();
    if (!json.success) throw new Error(json.error);
    return json.data;
}

export async function deleteTrackerSite(id: number): Promise<void> {
    const res = await fetch(`/api/tracker/sites/${id}`, { method: "DELETE" });
    const json: ApiResponse<unknown> = await res.json();
    if (!json.success) throw new Error(json.error);
}
