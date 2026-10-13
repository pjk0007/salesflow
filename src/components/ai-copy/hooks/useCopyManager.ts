"use client";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { copyRequest } from "../api/copy";
import type { CopyCatalog, KnowledgeVersion } from "../types";

export function useCopyManager(enabled = true) {
    const [cursor, setCursor] = useState(0),
        [knowledgeCursor, setKnowledgeCursor] = useState(0);
    const catalog = useSWR<CopyCatalog>(
        enabled ? `/api/ai/copy-policies?cursor=${cursor}` : null,
        copyRequest,
    );
    const knowledge = useSWR<{ versions: KnowledgeVersion[]; nextCursor: number | null }>(
        enabled ? `/api/ai/knowledge-versions?cursor=${knowledgeCursor}` : null,
        copyRequest,
    );
    const { mutate } = useSWRConfig();
    const [pending, setPending] = useState(false),
        [actionError, setActionError] = useState<string | null>(null);
    async function act<T>(url: string, body: unknown): Promise<T | undefined> {
        setPending(true);
        setActionError(null);
        try {
            const data = await copyRequest<T>(url, body);
            await mutate(
                (key) =>
                    typeof key === "string" &&
                    (key.startsWith("/api/ai/") || key.startsWith("/api/email/experiments")),
            );
            toast.success("저장했습니다.");
            return data;
        } catch (error) {
            const message = error instanceof Error ? error.message : "처리하지 못했습니다.";
            setActionError(message);
            toast.error(message);
        } finally {
            setPending(false);
        }
    }
    return {
        catalog: catalog.data,
        knowledge: knowledge.data,
        loading: catalog.isLoading || knowledge.isLoading,
        error: catalog.error ?? knowledge.error,
        pending,
        actionError,
        act,
        cursor,
        setCursor,
        knowledgeCursor,
        setKnowledgeCursor,
    };
}
