import type { KnowledgeSnapshot } from "@/lib/ai-copy/types";
export interface SupportSettings {
    version: number;
    mode: "manual" | "draft" | "reply";
    knowledgeVersionId: number | null;
    model: string;
    instructions: string;
    handoffAssigneeId: string | null;
    handoffMessage: string;
    maxJobsPerDay: number;
}
export interface SupportCatalog {
    settings: SupportSettings;
    knowledge: {
        id: number;
        name: string;
        state: string;
        claims: number;
        fingerprint: string;
    }[];
    models: {
        id: string;
        label: string;
        provider: string;
        configured: boolean;
    }[];
    workerEnabled: boolean;
    history: {
        id: string;
        version: number;
        actorName: string;
        createdAt: string;
        snapshot: SupportSettings;
    }[];
}
export interface SupportKnowledge {
    id: number;
    name: string;
    state: string;
    workspaceId: number;
    snapshot: KnowledgeSnapshot;
    fingerprint: string;
    createdAt: string;
    approvedAt: string | null;
}
export interface SupportJob {
    id: string;
    state: string;
    reason: string | null;
    answer: string | null;
    mode: string;
    sourceMessageId: number;
    createdAt: string;
    settingsVersion: number;
    knowledgeVersionId: number | null;
    citations: { sourceId: string; quote: string; sourceUrl: string }[];
    sources: { id: string; text: string; sourceUrl: string }[];
    sentMessageId: number | null;
}
export interface SupportJobDetail {
    job: SupportJob;
    usable: boolean;
    calls: {
        id: string;
        stage: string;
        state: string;
        model: string;
        promptTokens: number | null;
        completionTokens: number | null;
    }[];
}
export type SupportJobSummary = Pick<
    SupportJob,
    | "id"
    | "state"
    | "createdAt"
    | "mode"
    | "sourceMessageId"
    | "settingsVersion"
    | "knowledgeVersionId"
    | "reason"
    | "sentMessageId"
>;
