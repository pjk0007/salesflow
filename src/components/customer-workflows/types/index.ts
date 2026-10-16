import type { WorkflowDefinition } from "@/lib/customer-workflows/rules";
export type {
    WorkflowDefinition,
    WorkflowStep,
    WorkflowGroup,
} from "@/lib/customer-workflows/rules";
export interface Workflow {
    id: string;
    workspaceId: number;
    name: string;
    description: string;
    version: number;
    generation: number;
    enabled: boolean;
    activeRevisionId: string | null;
    updatedAt: string;
}
export interface Revision {
    name: string;
    description: string;
    id: string;
    version: number;
    definition: WorkflowDefinition;
    fingerprint: string;
    publishedAt: string | null;
    createdAt: string;
}
export interface WorkflowList {
    rows: Workflow[];
    hasMore: boolean;
    workerEnabled: boolean;
    eventTypes: string[];
    stepNames: Record<string, string>;
}
export interface WorkflowDetail {
    workflow: Workflow;
    revisions: Revision[];
    history: {
        id: string;
        actorName: string;
        action: string;
        detail: Record<string, unknown>;
        createdAt: string;
    }[];
}
export interface Preview {
    id: string;
    revisionId: string;
    passed: boolean;
    report: {
        matched: boolean;
        hasCustomerReply: boolean;
        errors: string[];
        steps: {
            id: string;
            label: string;
            kind: string;
            status: string;
            detail: string;
        }[];
        context: Record<string, unknown>;
    };
}
export interface WorkflowEvent {
    customerName?: string | null;
    id: string;
    type: string;
    createdAt: string;
    payload: Record<string, unknown>;
}
export interface WorkflowRun {
    id: string;
    revisionId: string;
    eventId: string;
    state: string;
    cursor: number;
    attempts: number;
    reason: string | null;
    eligibleAt: string;
    createdAt: string;
    updatedAt: string;
}
export interface WorkflowRunDetail {
    run: WorkflowRun & { eventSnapshot: Record<string, unknown> };
    revision: Revision;
    steps: {
        id: string;
        position: number;
        kind: string;
        state: string;
        detail: Record<string, unknown>;
        createdAt: string;
    }[];
    history: WorkflowDetail["history"];
}
