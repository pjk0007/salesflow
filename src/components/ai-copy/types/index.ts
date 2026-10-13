import type {
    CopyPurpose,
    CopyVersion,
    KnowledgeSnapshot,
    PolicySnapshot,
} from "@/lib/ai-copy/types";
export type { CopyPurpose, KnowledgeSnapshot, PolicySnapshot };
export type PolicyVersion = CopyVersion<PolicySnapshot> & { name: string; purpose: CopyPurpose };
export type KnowledgeVersion = CopyVersion<KnowledgeSnapshot> & { name: string };
export interface CopyCatalog {
    versions: PolicyVersion[];
    nextCursor: number | null;
    workspaces: { id: number; name: string }[];
    rules: { id: number; name: string | null; workspace_id: number; partition_id: number }[];
    bindings: {
        workspace_id: number;
        purpose: CopyPurpose;
        rule_id: number;
        policy_version_id: number;
        knowledge_version_id: number;
    }[];
}
export interface GenerationRow {
    id: number;
    workspace_id: number;
    purpose: CopyPurpose;
    origin: string;
    state: string;
    reason: string | null;
    attempts: number;
    cost_known: boolean;
    cost_krw: string | null;
    created_at: string;
    policy_version_id: number | null;
    knowledge_version_id: number | null;
    send_log_id: number | null;
}
export type EvaluationReport = ReturnType<
    typeof import("@/lib/ai-copy/evaluation-rules").evaluateCopyRun
>;
export interface EvaluationRow {
    id: number;
    purpose: CopyPurpose;
    state: string;
    report: EvaluationReport | null;
    created_at: string;
    pairs: {
        workspaceId: number;
        baselinePolicyId: number;
        candidatePolicyId: number;
        knowledgeVersionId: number;
    }[];
}
