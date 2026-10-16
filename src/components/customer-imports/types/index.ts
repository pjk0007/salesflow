import type { ImportPlanRow, ImportInput } from "@/lib/customer-imports/rules";
export type ImportForm = ImportInput;
export type ImportJob = {
    id: string;
    workspaceId: number;
    source: string;
    namespace: string;
    state: string;
    version: number;
    cursor: number;
    total: number;
    fingerprint: string;
    errors: string[];
    warnings: string[];
    reason: string | null;
    counts: Record<string, number>;
    rows: ImportPlanRow[];
    hasMore: boolean;
    input: Omit<ImportInput, "content">;
    results: {
        position: number;
        operation: string;
        targetId: string;
        targetFingerprint: string;
    }[];
    audit: {
        id: string;
        actorName: string;
        action: string;
        detail: Record<string, unknown>;
        createdAt: string;
    }[];
};
export type ImportSummary = Pick<
    ImportJob,
    "id" | "source" | "namespace" | "state" | "cursor" | "version" | "reason"
> & { createdAt: string };
