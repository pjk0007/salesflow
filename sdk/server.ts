/** 샌드비 서비스 서버용 클라이언트. API 토큰은 사이트 서버에만 둡니다. */
export interface SendbCompanyInput {
    workspaceId: number;
    externalId: string;
    name: string;
    domain?: string | null;
    attributes?: Record<string, unknown>;
}
export interface SendbContactInput {
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
    id: string;
    companyIds: string[];
}
export interface SendbCompany extends SendbCompanyInput {
    id: string;
}
export interface SendbIdentity {
    identityToken: string;
    expiresAt: string;
    channelKey: string;
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
    listContacts(workspaceId: number, before?: string) {
        return this.request<SendbContact[]>(
            `/api/v1/crm/contacts?workspaceId=${workspaceId}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
        );
    }
    listCompanies(workspaceId: number, before?: string) {
        return this.request<SendbCompany[]>(
            `/api/v1/crm/companies?workspaceId=${workspaceId}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
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
            filter?: "all" | "mine" | "unassigned" | "unread" | "priority";
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
    reply(
        conversationId: string,
        body: string,
        clientId: string,
        kind: "reply" | "note" = "reply",
    ) {
        return this.request(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}`,
            "POST",
            { body, clientId, kind },
        );
    }
    updateConversation(
        conversationId: string,
        change: {
            status?: "open" | "snoozed" | "closed";
            assigneeId?: string | null;
            priority?: boolean;
            tags?: string[];
        },
    ) {
        return this.request(
            `/api/v1/inbox/conversations/${encodeURIComponent(conversationId)}`,
            "PATCH",
            change,
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
