import type {
    SendbOperationsSettings,
    SendbOperationsPolicy,
    SendbOperationsReport,
    SendbNotificationPage,
    SendbConversationOperations,
} from "./support-types";
export type * from "./support-types";
import type {
    SendbEmailFile,
    SendbInboundEmail,
    SendbEmailMailbox,
    SendbEmailClaim,
    SendbEmailDeliveryAction,
    SendbEmailReplySelection,
    SendbEmailContext,
} from "./email-types";
export type {
    SendbEmailFile,
    SendbInboundEmail,
    SendbEmailMailbox,
    SendbEmailClaim,
    SendbEmailDeliveryAction,
    SendbEmailReplySelection,
    SendbEmailContext,
} from "./email-types";
/** 샌드비 서비스 서버용 클라이언트. API 토큰은 사이트 서버에만 둡니다. */
export { verifySendbWebhook } from "./webhooks";
export interface SendbCompanyInput {
    version?: number;
    workspaceId: number;
    externalId: string;
    name: string;
    domain?: string | null;
    attributes?: Record<string, unknown>;
}
export interface SendbContactInput {
    version?: number;
    workspaceId: number;
    externalId: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    recordId?: number | null;
    companyIds?: string[];
    lifecycleStage?: "lead" | "prospect" | "customer" | "inactive";
    isInternal?: boolean;
    attributes?: Record<string, unknown>;
}
export interface SendbContact extends SendbContactInput {
    version: number;
    archivedAt: string | null;
    id: string;
    companyIds: string[];
}
export interface SendbCompany extends SendbCompanyInput {
    version: number;
    archivedAt: string | null;
    id: string;
}
export interface SendbCustomerList {
    before?: string;
    q?: string;
    archived?: "false" | "true" | "all";
}
export interface SendbCustomerHistory {
    id: string;
    version: number;
    action: string;
    actorName: string;
    source: string;
    createdAt: string;
    reason: string;
    changes: Record<
        string,
        {
            before: unknown;
            after: unknown;
            beforePresent: boolean;
            afterPresent: boolean;
            beforeLabel?: string;
            afterLabel?: string;
        }
    >;
}
export interface SendbCustomerDetail<T> {
    item: T;
    history: SendbCustomerHistory[];
    hasMore: boolean;
    creationTracked: boolean;
    impact: {
        deals: number;
        tasks: number;
        conversations: number;
        pendingWorkflows: number;
    };
}
function customerQuery(
    workspaceId: number,
    options?: string | SendbCustomerList,
) {
    const value =
        typeof options === "string" ? { before: options } : (options ?? {});
    return new URLSearchParams({
        workspaceId: String(workspaceId),
        ...Object.fromEntries(
            Object.entries(value).filter(([, v]) => v !== undefined),
        ),
    }).toString();
}
export interface SendbIdentity {
    identityToken: string;
    expiresAt: string;
    channelKey: string;
}
export interface SendbImportJob {
    id: string;
    workspaceId: number;
    source: string;
    namespace: string;
    state:
        | "ready"
        | "running"
        | "paused"
        | "failed"
        | "completed"
        | "cancelled";
    version: number;
    cursor: number;
    total: number;
    fingerprint: string;
    errors: string[];
    warnings: string[];
    reason: string | null;
    counts: Record<string, number>;
    hasMore: boolean;
    rows: {
        index: number;
        kind: string;
        sourceId: string;
        operation: string;
        data: Record<string, unknown>;
        errors: string[];
        warnings: string[];
    }[];
    results: { position: number; operation: string; targetId: string }[];
}
export interface SendbEventInput {
    eventId: string;
    name: string;
    properties?: Record<string, unknown>;
    occurredAt?: string;
}
export interface SendbCustomerActivity {
    id: string;
    contactId: string | null;
    source: string;
    entityId: string;
    action: string;
    summary: string;
    actorName: string | null;
    properties: Record<string, unknown>;
    occurredAt: string;
}
export interface SendbPipelineInput {
    workspaceId: number;
    externalId: string;
    name: string;
    stages: { id: string; name: string; category: "open" | "won" | "lost" }[];
}
export interface SendbPipeline extends SendbPipelineInput {
    id: string;
    version: number;
    createdAt: string;
    updatedAt: string;
}
export interface SendbDealInput {
    workspaceId: number;
    externalId: string;
    title: string;
    pipelineId: string;
    stageId: string;
    contactId?: string | null;
    companyId?: string | null;
    ownerId?: string | null;
    amount: string;
    currency: string;
    expectedCloseDate?: string | null;
    notes?: string;
}
export interface SendbDeal extends SendbDealInput {
    id: string;
    version: number;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface SendbTaskInput {
    workspaceId: number;
    externalId: string;
    title: string;
    body?: string;
    contactId?: string | null;
    companyId?: string | null;
    ownerId?: string | null;
    dealId?: string | null;
    dueAt?: string | null;
    status?: "open" | "done" | "cancelled";
}
export interface SendbTask extends SendbTaskInput {
    id: string;
    version: number;
    status: "open" | "done" | "cancelled";
    completedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface SendbConversation {
    emailContext?: SendbEmailContext;
    medium: "web" | "email";
    aiState: "auto" | "human";
    aiHandoffReason: string | null;
    version: number;
    id: string;
    channelId: number;
    contactId: string | null;
    name: string;
    email: string | null;
    status: "open" | "snoozed" | "closed";
    assigneeId: string | null;
    recordId: number | null;
    priority: boolean;
    tags: string[];
    preview: string;
    lastMessageAt: string;
    customerSeq: number;
    unread: boolean;
}
function salesQuery(
    workspaceId: number,
    options: Record<string, string | undefined>,
) {
    const params = new URLSearchParams({ workspaceId: String(workspaceId) });
    for (const [key, value] of Object.entries(options))
        if (value !== undefined) params.set(key, value);
    return params;
}
export class SendbApiError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message);
        this.name = "SendbApiError";
    }
}
export class SendbClient {
    supportSettings(channelId: number) {
        return this.request<SendbOperationsSettings>(
            `/api/v1/support/channels/${channelId}/settings`,
        );
    }
    saveSupportSettings(
        channelId: number,
        version: number,
        policy: SendbOperationsPolicy,
    ) {
        return this.request<SendbOperationsSettings>(
            `/api/v1/support/channels/${channelId}/settings`,
            "POST",
            { version, policy },
        );
    }
    supportReport(
        channelId: number,
        options: {
            from: string;
            to: string;
            medium?: "all" | "web" | "email";
            before?: string;
        },
    ) {
        return this.request<SendbOperationsReport>(
            `/api/v1/support/reports?${new URLSearchParams({ channelId: String(channelId), ...options })}`,
        );
    }
    supportConversation(id: string) {
        return this.request<SendbConversationOperations>(
            `/api/v1/support/conversations/${encodeURIComponent(id)}`,
        );
    }
    supportNotifications(
        channelId: number,
        options: { before?: string; unread?: boolean } = {},
    ) {
        return this.request<SendbNotificationPage>(
            `/api/v1/support/notifications?${new URLSearchParams({ channelId: String(channelId), ...(options.before ? { before: options.before } : {}), ...(options.unread ? { unread: "true" } : {}) })}`,
        );
    }
    readSupportNotifications(channelId: number, ids: string[]) {
        return this.request(
            `/api/v1/support/notifications?channelId=${channelId}`,
            "POST",
            { action: "read", ids },
        );
    }

    pendingEmailFiles(id: string, before?: string) {
        return this.request<{ rows: SendbEmailFile[]; hasMore: boolean }>(
            `/api/v1/email/mailboxes/${encodeURIComponent(id)}/files${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        );
    }

    emailReceiptFiles(id: string) {
        return this.request<SendbEmailFile[]>(
            `/api/v1/email/receipts/${encodeURIComponent(id)}/files`,
        );
    }
    failEmailFile(
        id: string,
        errorCode: "download_failed" | "source_missing" | "size_mismatch",
    ) {
        return this.request(
            `/api/v1/email/files/${encodeURIComponent(id)}`,
            "POST",
            { action: "failed", errorCode },
        );
    }
    uploadEmailFile(id: string, file: Blob, fileName: string) {
        const form = new FormData();
        form.set("file", file, fileName);
        form.set("clientId", id);
        form.set("kind", "customer");
        return this.#upload<SendbEmailFile>(
            `/api/v1/email/files/${encodeURIComponent(id)}`,
            form,
        );
    }
    downloadEmailDeliveryFile(id: string, fileId: string, leaseToken: string) {
        return this.#downloadFile(
            `/api/v1/email/deliveries/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
            { "X-Sendb-Email-Lease": leaseToken },
        );
    }

    emailMailboxes(workspaceId: number) {
        return this.request<SendbEmailMailbox[]>(
            `/api/v1/email/mailboxes?workspaceId=${workspaceId}`,
        );
    }
    createEmailMailbox(input: {
        workspaceId: number;
        address: string;
        name: string;
    }) {
        return this.request<SendbEmailMailbox>(
            "/api/v1/email/mailboxes",
            "POST",
            input,
        );
    }
    changeEmailMailbox(id: string, version: number, enabled: boolean) {
        return this.request<SendbEmailMailbox>(
            `/api/v1/email/mailboxes/${encodeURIComponent(id)}`,
            "POST",
            { version, enabled },
        );
    }
    receiveEmail(id: string, input: SendbInboundEmail) {
        return this.request<{
            receiptId: string;
            messageId: number | null;
            conversationId?: string;
            ignoredReason: string | null;
            duplicate: boolean;
        }>(
            `/api/v1/email/mailboxes/${encodeURIComponent(id)}/receive`,
            "POST",
            input,
        );
    }
    claimEmail(id: string) {
        return this.request<SendbEmailClaim | null>(
            `/api/v1/email/mailboxes/${encodeURIComponent(id)}/claim`,
            "POST",
        );
    }
    changeEmailDelivery(id: string, input: SendbEmailDeliveryAction) {
        return this.request(
            `/api/v1/email/deliveries/${encodeURIComponent(id)}`,
            "POST",
            input,
        );
    }
    imports(workspaceId: number, before?: string) {
        return this.request<{
            rows: Pick<
                SendbImportJob,
                "id" | "state" | "source" | "namespace" | "cursor" | "version"
            >[];
            hasMore: boolean;
        }>(
            `/api/v1/imports?workspaceId=${workspaceId}${before ? "&before=" + encodeURIComponent(before) : ""}`,
        );
    }
    previewImport(input: unknown) {
        return this.request<SendbImportJob>("/api/v1/imports", "POST", input);
    }
    import(id: string, offset = 0) {
        return this.request<SendbImportJob>(
            `/api/v1/imports/${encodeURIComponent(id)}?offset=${offset}`,
        );
    }
    changeImport(
        id: string,
        input: {
            action: "start" | "pause" | "resume" | "cancel";
            version: number;
            fingerprint?: string;
            acknowledge?: boolean;
        },
    ) {
        return this.request<SendbImportJob>(
            `/api/v1/imports/${encodeURIComponent(id)}`,
            "POST",
            input,
        );
    }
    stepImport(id: string, cursor: number) {
        return this.request<SendbImportJob>(
            `/api/v1/imports/${encodeURIComponent(id)}`,
            "POST",
            { action: "step", cursor },
        );
    }
    #apiToken: string;
    #base: string;
    #fetch: typeof fetch;
    constructor(options: {
        apiBase: string;
        apiToken: string;
        fetchImpl?: typeof fetch;
    }) {
        if (typeof window !== "undefined")
            throw new Error("SendbClient는 사이트 서버에서 사용해주세요.");
        const url = new URL(options.apiBase);
        if (
            url.username ||
            url.password ||
            !(
                url.protocol === "https:" ||
                (url.protocol === "http:" &&
                    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
            )
        )
            throw new Error("샌드비 API 주소를 확인해주세요.");
        if (!options.apiToken) throw new Error("서비스 API 토큰이 필요합니다.");
        this.#apiToken = options.apiToken;
        this.#base = url.origin;
        this.#fetch = options.fetchImpl ?? fetch;
    }
    async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
        const response = await this.#fetch(this.#base + path, {
            method,
            headers: {
                Authorization: `Bearer ${this.#apiToken}`,
                "Content-Type": "application/json",
            },
            cache: "no-store",
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const data = await response.json().catch(() => {
            throw new SendbApiError(
                "샌드비 API 응답을 확인할 수 없습니다.",
                response.status,
            );
        });
        if (!response.ok || !data.success)
            throw new SendbApiError(
                data.error || "샌드비 API 요청을 처리하지 못했습니다.",
                response.status,
            );
        return data.data;
    }
    webhooks(workspaceId: number) {
        return this.request<{
            endpoints: {
                id: string;
                name: string;
                url: string;
                eventTypes: string[];
                enabled: boolean;
                version: number;
                secretHint: string;
            }[];
            eventTypes: string[];
            workerEnabled: boolean;
        }>(`/api/v1/webhooks?workspaceId=${workspaceId}`);
    }
    createWebhook(input: {
        workspaceId: number;
        name: string;
        url: string;
        eventTypes: string[];
    }) {
        return this.request<{
            endpoint: { id: string; version: number; enabled: boolean };
            secret: string;
        }>("/api/v1/webhooks", "POST", input);
    }
    updateWebhook(
        id: string,
        input: {
            version: number;
            name?: string;
            url?: string;
            eventTypes?: string[];
            enabled?: boolean;
        },
    ) {
        return this.request<{
            endpoint: { id: string; version: number; enabled: boolean };
        }>(`/api/v1/webhooks/${encodeURIComponent(id)}`, "PATCH", input);
    }
    webhookDeliveries(id: string, before?: string) {
        return this.request<{
            rows: {
                id: string;
                eventId: string;
                type: string;
                state: string;
                attempts: number;
            }[];
            hasMore: boolean;
        }>(
            `/api/v1/webhooks/${encodeURIComponent(id)}/deliveries${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    retryWebhookDelivery(id: string) {
        return this.request(
            `/api/v1/webhook-deliveries/${encodeURIComponent(id)}`,
            "POST",
            { action: "retry" },
        );
    }
    supportAiSettings(workspaceId: number) {
        return this.request<
            import("../src/components/customer-ai/types").SupportCatalog
        >(`/api/v1/support-ai/settings?workspaceId=${workspaceId}`);
    }
    workflows(workspaceId: number, before?: string) {
        return this.request<
            import("../src/components/customer-workflows/types").WorkflowList
        >(
            `/api/v1/workflows?workspaceId=${workspaceId}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    workflow(id: string) {
        return this.request<
            import("../src/components/customer-workflows/types").WorkflowDetail
        >(`/api/v1/workflows/${encodeURIComponent(id)}`);
    }
    saveWorkflow(
        input: {
            workspaceId: number;
            version: number;
            name: string;
            description: string;
            definition: import("../src/components/customer-workflows/types").WorkflowDefinition;
        },
        id?: string,
    ) {
        return this.request<{
            workflow: import("../src/components/customer-workflows/types").Workflow;
            revision: import("../src/components/customer-workflows/types").Revision;
        }>(
            `/api/v1/workflows${id ? `/${encodeURIComponent(id)}` : ""}`,
            id ? "PATCH" : "POST",
            input,
        );
    }
    workflowEvents(workspaceId: number, before?: string) {
        return this.request<{
            rows: import("../src/components/customer-workflows/types").WorkflowEvent[];
            hasMore: boolean;
        }>(
            `/api/v1/workflows/events?workspaceId=${workspaceId}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    previewWorkflow(id: string, revisionId: string, eventId: string) {
        return this.request<
            import("../src/components/customer-workflows/types").Preview
        >(`/api/v1/workflows/${encodeURIComponent(id)}`, "POST", {
            action: "preview",
            revisionId,
            eventId,
        });
    }
    publishWorkflow(
        id: string,
        version: number,
        revisionId: string,
        previewId: string,
        allowCustomerReplies = false,
    ) {
        return this.request(
            `/api/v1/workflows/${encodeURIComponent(id)}`,
            "POST",
            {
                action: "publish",
                version,
                revisionId,
                previewId,
                allowCustomerReplies,
            },
        );
    }
    disableWorkflow(id: string, version: number) {
        return this.request(
            `/api/v1/workflows/${encodeURIComponent(id)}`,
            "POST",
            { action: "disable", version },
        );
    }
    workflowRuns(id: string, before?: string) {
        return this.request<{
            rows: import("../src/components/customer-workflows/types").WorkflowRun[];
            hasMore: boolean;
        }>(
            `/api/v1/workflows/${encodeURIComponent(id)}/runs${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    workflowRun(id: string, runId: string) {
        return this.request<
            import("../src/components/customer-workflows/types").WorkflowRunDetail
        >(
            `/api/v1/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
        );
    }
    changeWorkflowRun(id: string, runId: string, action: "cancel" | "retry") {
        return this.request(
            `/api/v1/workflows/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
            "POST",
            { action },
        );
    }
    updateSupportAiSettings(
        workspaceId: number,
        settings: import("../src/components/customer-ai/types").SupportSettings,
    ) {
        return this.request<
            import("../src/components/customer-ai/types").SupportSettings
        >("/api/v1/support-ai/settings", "POST", { workspaceId, ...settings });
    }
    supportKnowledge(workspaceId: number, before?: number) {
        return this.request<{
            rows: import("../src/components/customer-ai/types").SupportKnowledge[];
            hasMore: boolean;
        }>(
            `/api/v1/support-ai/knowledge?workspaceId=${workspaceId}${before ? `&before=${before}` : ""}`,
        );
    }
    createSupportKnowledge(
        workspaceId: number,
        name: string,
        snapshot: import("../src/lib/ai-copy/types").KnowledgeSnapshot,
    ) {
        return this.request<{ id: number }>(
            "/api/v1/support-ai/knowledge",
            "POST",
            { workspaceId, name, snapshot },
        );
    }
    reviewSupportKnowledge(
        workspaceId: number,
        id: number,
        action: "approve" | "block",
        reason?: string,
    ) {
        return this.request(`/api/v1/support-ai/knowledge/${id}`, "POST", {
            workspaceId,
            action,
            ...(reason ? { reason } : {}),
        });
    }
    supportDrafts(conversationId: string, before?: string) {
        return this.request<{
            rows: import("../src/components/customer-ai/types").SupportJobSummary[];
            hasMore: boolean;
        }>(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/ai${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    generateSupportDraft(conversationId: string, clientId: string) {
        return this.request<{ jobId: string }>(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/ai`,
            "POST",
            { clientId },
        );
    }
    supportDraft(conversationId: string, runId: string) {
        return this.request<
            import("../src/components/customer-ai/types").SupportJobDetail
        >(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/ai/${encodeURIComponent(runId)}`,
        );
    }
    cancelSupportDraft(conversationId: string, runId: string) {
        return this.request(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/ai/${encodeURIComponent(runId)}`,
            "POST",
            { action: "cancel" },
        );
    }
    upsertCompany(input: SendbCompanyInput) {
        return this.request<SendbCompany>(
            "/api/v1/crm/companies",
            "POST",
            input,
        );
    }
    pipelines(workspaceId: number, before?: string) {
        return this.request<SendbPipeline[]>(
            `/api/v1/crm/pipelines?workspaceId=${workspaceId}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    createPipeline(input: SendbPipelineInput) {
        return this.request<SendbPipeline>(
            "/api/v1/crm/pipelines",
            "POST",
            input,
        );
    }
    updatePipeline(
        id: string,
        input: {
            workspaceId: number;
            version: number;
            name?: string;
            stages?: SendbPipelineInput["stages"];
        },
    ) {
        return this.request<SendbPipeline>(
            `/api/v1/crm/pipelines/${encodeURIComponent(id)}`,
            "PATCH",
            input,
        );
    }
    deals(
        workspaceId: number,
        options: {
            before?: string;
            pipelineId?: string;
            q?: string;
            archived?: "true" | "false";
        } = {},
    ) {
        return this.request<SendbDeal[]>(
            `/api/v1/crm/deals?${salesQuery(workspaceId, options)}`,
        );
    }
    createDeal(input: SendbDealInput) {
        return this.request<SendbDeal>("/api/v1/crm/deals", "POST", input);
    }
    updateDeal(
        id: string,
        input: {
            workspaceId: number;
            version: number;
            archived?: boolean;
        } & Partial<Omit<SendbDealInput, "workspaceId" | "externalId">>,
    ) {
        return this.request<SendbDeal>(
            `/api/v1/crm/deals/${encodeURIComponent(id)}`,
            "PATCH",
            input,
        );
    }
    tasks(
        workspaceId: number,
        options: {
            before?: string;
            q?: string;
            status?: "open" | "done" | "cancelled";
        } = {},
    ) {
        return this.request<SendbTask[]>(
            `/api/v1/crm/tasks?${salesQuery(workspaceId, options)}`,
        );
    }
    createTask(input: SendbTaskInput) {
        return this.request<SendbTask>("/api/v1/crm/tasks", "POST", input);
    }
    updateTask(
        id: string,
        input: { workspaceId: number; version: number } & Partial<
            Omit<SendbTaskInput, "workspaceId" | "externalId">
        >,
    ) {
        return this.request<SendbTask>(
            `/api/v1/crm/tasks/${encodeURIComponent(id)}`,
            "PATCH",
            input,
        );
    }
    upsertContact(input: SendbContactInput) {
        return this.request<SendbContact>(
            "/api/v1/crm/contacts",
            "POST",
            input,
        );
    }
    listContacts(workspaceId: number, options?: string | SendbCustomerList) {
        return this.request<SendbContact[]>(
            `/api/v1/crm/contacts?${customerQuery(workspaceId, options)}`,
        );
    }
    listCompanies(workspaceId: number, options?: string | SendbCustomerList) {
        return this.request<SendbCompany[]>(
            `/api/v1/crm/companies?${customerQuery(workspaceId, options)}`,
        );
    }
    contact(workspaceId: number, id: string, before?: string) {
        return this.request<SendbCustomerDetail<SendbContact>>(
            `/api/v1/crm/contacts/${encodeURIComponent(id)}?${customerQuery(workspaceId, before)}`,
        );
    }
    company(workspaceId: number, id: string, before?: string) {
        return this.request<SendbCustomerDetail<SendbCompany>>(
            `/api/v1/crm/companies/${encodeURIComponent(id)}?${customerQuery(workspaceId, before)}`,
        );
    }
    updateContact(
        id: string,
        input: { workspaceId: number; version: number } & Partial<
            Omit<SendbContactInput, "workspaceId" | "externalId" | "version">
        >,
    ) {
        return this.request<SendbContact>(
            `/api/v1/crm/contacts/${encodeURIComponent(id)}`,
            "PATCH",
            input,
        );
    }
    updateCompany(
        id: string,
        input: { workspaceId: number; version: number } & Partial<
            Omit<SendbCompanyInput, "workspaceId" | "externalId" | "version">
        >,
    ) {
        return this.request<SendbCompany>(
            `/api/v1/crm/companies/${encodeURIComponent(id)}`,
            "PATCH",
            input,
        );
    }
    archiveContact(
        workspaceId: number,
        id: string,
        version: number,
        reason = "",
    ) {
        return this.request<{ item: SendbContact; cancelledWorkflows: number }>(
            `/api/v1/crm/contacts/${encodeURIComponent(id)}`,
            "POST",
            { workspaceId, version, action: "archive", reason },
        );
    }
    restoreContact(
        workspaceId: number,
        id: string,
        version: number,
        reason = "",
    ) {
        return this.request<{ item: SendbContact; cancelledWorkflows: number }>(
            `/api/v1/crm/contacts/${encodeURIComponent(id)}`,
            "POST",
            { workspaceId, version, action: "restore", reason },
        );
    }
    archiveCompany(
        workspaceId: number,
        id: string,
        version: number,
        reason = "",
    ) {
        return this.request<{ item: SendbCompany; cancelledWorkflows: number }>(
            `/api/v1/crm/companies/${encodeURIComponent(id)}`,
            "POST",
            { workspaceId, version, action: "archive", reason },
        );
    }
    restoreCompany(
        workspaceId: number,
        id: string,
        version: number,
        reason = "",
    ) {
        return this.request<{ item: SendbCompany; cancelledWorkflows: number }>(
            `/api/v1/crm/companies/${encodeURIComponent(id)}`,
            "POST",
            { workspaceId, version, action: "restore", reason },
        );
    }
    customerIdentity(channelId: number, contactId: string) {
        return this.request<SendbIdentity>("/api/v1/inbox/sessions", "POST", {
            channelId,
            contactId,
        });
    }
    track(workspaceId: number, contactId: string, event: SendbEventInput) {
        return this.request(
            `/api/v1/crm/contacts/${encodeURIComponent(contactId)}/events`,
            "POST",
            { workspaceId, ...event },
        );
    }
    customerActivities(
        workspaceId: number,
        contactId: string,
        before?: string,
    ) {
        return this.request<SendbCustomerActivity[]>(
            `/api/v1/crm/contacts/${encodeURIComponent(contactId)}/activity?workspaceId=${workspaceId}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    conversations(
        channelId: number,
        options: {
            q?: string;
            status?: "open" | "snoozed" | "closed";
            filter?:
                | "all"
                | "mine"
                | "unassigned"
                | "unread"
                | "priority"
                | "history";
            before?: string;
            beforeId?: string;
        } = {},
    ) {
        const params = new URLSearchParams({ channelId: String(channelId) });
        for (const [key, value] of Object.entries(options))
            if (value !== undefined) params.set(key, value);
        return this.request<SendbConversation[]>(
            `/api/v1/inbox/conversations?${params}`,
        );
    }
    inboxConversation(conversationId: string, before?: string) {
        return this.request<{
            conversation: SendbConversation;
            messages: import("../src/components/inbox/types").ChatMessage[];
            hasOlder: boolean;
        }>(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    reply(
        conversationId: string,
        body: string,
        clientId: string,
        kind: "reply" | "note" = "reply",
        attachmentIds: string[] = [],
        aiDraftId?: string,
        emailReply?: SendbEmailReplySelection,
    ) {
        return this.request(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}`,
            "POST",
            {
                body,
                clientId,
                kind,
                attachmentIds,
                ...(aiDraftId ? { aiDraftId } : {}),
                ...(emailReply ? { emailReply } : {}),
            },
        );
    }
    updateConversation(
        conversationId: string,
        change: {
            version?: number;
            status?: "open" | "snoozed" | "closed";
            assigneeId?: string | null;
            priority?: boolean;
            tags?: string[];
            aiState?: "auto" | "human";
        },
    ) {
        return this.request(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}`,
            "PATCH",
            change,
        );
    }
    async uploadAttachment(
        conversationId: string,
        file: Blob,
        fileName: string,
        clientId: string,
        kind: "reply" | "note" = "reply",
    ) {
        const form = new FormData();
        form.set("file", file, fileName);
        form.set("clientId", clientId);
        form.set("kind", kind);
        return this.#upload<{
            id: string;
            fileName: string;
            contentType: string;
            size: number;
        }>(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/attachments`,
            form,
        );
    }
    async #upload<T>(path: string, form: FormData): Promise<T> {
        const response = await this.#fetch(this.#base + path, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.#apiToken}` },
            body: form,
            cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok || !result.success)
            throw new SendbApiError(
                result.error ?? "파일을 올리지 못했습니다.",
                response.status,
            );
        return result.data as T;
    }
    cancelAttachment(conversationId: string, id: string) {
        return this.request(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/attachments`,
            "POST",
            { action: "cancel", id },
        );
    }
    downloadAttachment(id: string) {
        return this.#downloadFile(
            `/api/v1/inbox/attachments/${encodeURIComponent(id)}`,
        );
    }
    async #downloadFile(
        path: string,
        extraHeaders: Record<string, string> = {},
    ) {
        const response = await this.#fetch(this.#base + path, {
            headers: {
                Authorization: `Bearer ${this.#apiToken}`,
                ...extraHeaders,
            },
            cache: "no-store",
        });
        if (!response.ok) {
            const result = await response.json();
            throw new SendbApiError(
                result.error ?? "파일을 불러오지 못했습니다.",
                response.status,
            );
        }
        return {
            bytes: await response.arrayBuffer(),
            contentType: response.headers.get("content-type"),
            disposition: response.headers.get("content-disposition"),
        };
    }
    conversationAudit(conversationId: string, before?: string) {
        return this.request<{
            rows: {
                id: string;
                actorName: string;
                action: string;
                changes: Record<
                    string,
                    {
                        before: unknown;
                        after: unknown;
                        beforeLabel?: string;
                        afterLabel?: string;
                    }
                >;
                createdAt: string;
            }[];
            hasMore: boolean;
        }>(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}/audit${before ? `?before=${encodeURIComponent(before)}` : ""}`,
        );
    }
}
export interface SiteCustomer {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    crmRecordId?: number | null;
    isInternal?: boolean;
    company?: {
        id: string;
        name: string;
        domain?: string;
        attributes?: Record<string, unknown>;
    };
    attributes?: Record<string, unknown>;
}
/** authenticate에는 사이트의 검증된 로그인 세션을 읽는 함수를 전달합니다. 요청 본문의 고객 ID를 신뢰하지 않습니다. */
export function createMemberIdentityHandler(options: {
    client: SendbClient;
    workspaceId: number;
    channelId: number;
    authenticate: (request: Request) => Promise<SiteCustomer | null>;
}) {
    return async function (request: Request): Promise<Response> {
        if (request.method !== "POST")
            return Response.json(
                { success: false, error: "POST 요청을 사용해주세요." },
                { status: 405 },
            );
        const origin = request.headers.get("origin");
        try {
            if (
                origin &&
                new URL(origin).origin !== new URL(request.url).origin
            )
                return Response.json(
                    { success: false, error: "허용되지 않은 요청입니다." },
                    { status: 403 },
                );
        } catch {
            return Response.json(
                { success: false, error: "허용되지 않은 요청입니다." },
                { status: 403 },
            );
        }
        const customer = await options.authenticate(request);
        if (!customer)
            return Response.json(
                { success: false, error: "사이트 로그인이 필요합니다." },
                { status: 401, headers: { "Cache-Control": "no-store" } },
            );
        let companyIds: string[] | undefined;
        if (customer.company) {
            const company = await options.client.upsertCompany({
                workspaceId: options.workspaceId,
                externalId: customer.company.id,
                name: customer.company.name,
                domain: customer.company.domain,
                attributes: customer.company.attributes,
            });
            companyIds = [company.id];
        }
        const contact = await options.client.upsertContact({
            workspaceId: options.workspaceId,
            externalId: customer.id,
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
            recordId: customer.crmRecordId,
            isInternal: customer.isInternal,
            companyIds,
            attributes: customer.attributes,
        });
        const identity = await options.client.customerIdentity(
            options.channelId,
            contact.id,
        );
        return Response.json(
            { success: true, data: identity },
            { headers: { "Cache-Control": "no-store" } },
        );
    };
}
