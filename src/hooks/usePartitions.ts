import useSWR from "swr";
import type { ApiResponse, CreatePartitionInput, CreateFolderInput } from "@/types";
import type { Folder, Partition } from "@/lib/db";

export interface PartitionTree {
    folders: (Folder & { partitions: Partition[] })[];
    ungrouped: Partition[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function usePartitions(workspaceId: number | null) {
    const { data, error, isLoading, mutate } = useSWR<ApiResponse<PartitionTree>>(
        workspaceId ? `/api/workspaces/${workspaceId}/partitions` : null,
        fetcher
    );

    const createPartition = async (input: CreatePartitionInput) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/partitions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const renamePartition = async (id: number, name: string) => {
        const res = await fetch(`/api/partitions/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deletePartition = async (id: number) => {
        const res = await fetch(`/api/partitions/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const createFolder = async (input: CreateFolderInput) => {
        const res = await fetch(`/api/workspaces/${workspaceId}/folders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const renameFolder = async (id: number, name: string) => {
        const res = await fetch(`/api/folders/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    const deleteFolder = async (id: number) => {
        const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
        const result = await res.json();
        if (result.success) mutate();
        return result;
    };

    return {
        partitionTree: data?.data ?? null,
        isLoading,
        error,
        mutate,
        createPartition,
        renamePartition,
        deletePartition,
        createFolder,
        renameFolder,
        deleteFolder,
    };
}
