/** Customer-facing/headless SDK. Supply a server-verified customer JWT, never a service API key. */
export type SendbCustomerMessageInput = {
    clientId: string;
    body: string;
    attachmentIds?: string[];
};
export interface SendbCustomerConversationPage {
    rows: {
        id: string;
        title: string;
        preview: string;
        status: "open" | "snoozed" | "closed";
        isCurrent: boolean;
        lastMessageAt: string;
        unread: number;
        /** Verified owner's imported ChannelTalk record; never a writable thread. */
        historyOnly?: boolean;
        /** Older servers omit this field and never return imported history. */
        readOnly?: boolean;
    }[];
    hasMore: boolean;
    nextBefore: string | null;
    unreadCount: number;
}
export interface SendbCustomerMessages {
    conversationId: string | null;
    readRevision: number;
    status: "open" | "snoozed" | "closed";
    aiState: "auto" | "human";
    profile: { name: string; email: string | null; identified: boolean };
    hasOlder: boolean;
    /** Imported public history is read-only even if its original status was open. */
    historyOnly?: boolean;
    readOnly?: boolean;
    messages: {
        id: number;
        clientId: string;
        kind: "customer" | "reply";
        body: string;
        authorName: string;
        createdAt: string;
        attachments: {
            id: string;
            fileName: string;
            size: number;
            contentType: string;
        }[];
    }[];
}
export class SendbMessengerError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}
export class SendbMessengerClient {
    #base: string;
    #key: string;
    #token: () => string | Promise<string>;
    #fetch: typeof fetch;
    constructor(options: {
        apiBase: string;
        channelKey: string;
        getToken: () => string | Promise<string>;
        fetchImpl?: typeof fetch;
    }) {
        const url = new URL(options.apiBase);
        if (
            !["https:", "http:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
        )
            throw new Error("상담 서버 주소를 확인해주세요.");
        if (!/^[a-f0-9]{48}$/.test(options.channelKey))
            throw new Error("상담 채널을 확인해주세요.");
        this.#base = url.origin;
        this.#key = options.channelKey;
        this.#token = options.getToken;
        this.#fetch = options.fetchImpl ?? fetch;
    }
    async #response(path: string, method = "GET", body?: unknown) {
        const multipart = body instanceof FormData;
        const response = await this.#fetch(
            `${this.#base}/api/messenger/${this.#key}${path}`,
            {
                method,
                headers: {
                    Authorization: `Bearer ${await this.#token()}`,
                    ...(body !== undefined && !multipart
                        ? { "Content-Type": "application/json" }
                        : {}),
                },
                ...(body === undefined
                    ? {}
                    : { body: multipart ? body : JSON.stringify(body) }),
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                signal: AbortSignal.timeout(15000),
            },
        );
        if (!response.ok) {
            let message = "상담 요청을 처리하지 못했습니다.";
            try {
                message = (await response.json()).error ?? message;
            } catch {}
            throw new SendbMessengerError(message, response.status);
        }
        return response;
    }
    async #request<T>(
        path: string,
        method = "GET",
        body?: unknown,
    ): Promise<T> {
        const value = await (await this.#response(path, method, body)).json();
        if (!value.success)
            throw new SendbMessengerError(
                value.error ?? "상담 요청을 처리하지 못했습니다.",
                400,
            );
        return value.data;
    }
    conversations(before?: string) {
        return this.#request<SendbCustomerConversationPage>(
            `/conversations${before ? "?before=" + encodeURIComponent(before) : ""}`,
        );
    }
    attachJourneyContext(journeyToken: string, conversationId?: string) {
        return this.#request<{ linked: boolean; reason?: string }>("", "POST", {
            action: "journey", journeyToken, conversationId,
        });
    }
    conversation(id?: string, before?: number) {
        const query = new URLSearchParams({
            ...(id ? { conversationId: id } : {}),
            ...(before ? { before: String(before) } : {}),
        });
        return this.#request<SendbCustomerMessages>(
            query.size ? "?" + query : "",
        );
    }
    createConversation(input: SendbCustomerMessageInput) {
        return this.#request<{
            conversationId: string;
            id: number;
            clientId: string;
        }>("/conversations", "POST", input);
    }
    sendMessage(conversationId: string, input: SendbCustomerMessageInput) {
        return this.#request<{ id: number; clientId: string }>(
            `?conversationId=${encodeURIComponent(conversationId)}`,
            "POST",
            input,
        );
    }
    markRead(
        conversationId: string,
        lastMessageId: number,
        readRevision?: number,
    ) {
        return this.#request<{
            lastMessageId: number;
            readRevision: number;
            unread: number;
        }>(
            `/conversations/${encodeURIComponent(conversationId)}/read`,
            "POST",
            {
                lastMessageId,
                ...(readRevision === undefined ? {} : { readRevision }),
            },
        );
    }
    upload(
        file: Blob,
        fileName: string,
        clientId: string,
        selection: { conversationId?: string; newConversation?: boolean } = {},
    ) {
        const form = new FormData();
        form.set("file", file, fileName);
        form.set("clientId", clientId);
        form.set("kind", "customer");
        const query = new URLSearchParams({
            ...(selection.conversationId
                ? { conversationId: selection.conversationId }
                : {}),
            ...(selection.newConversation ? { newConversation: "1" } : {}),
        });
        return this.#request<{
            id: string;
            fileName: string;
            size: number;
            contentType: string;
        }>(`/attachments${query.size ? "?" + query : ""}`, "POST", form);
    }
    async download(id: string, conversationId: string) {
        const response = await this.#response(
            `/attachments/${encodeURIComponent(id)}?conversationId=${encodeURIComponent(conversationId)}`,
        );
        return {
            bytes: await response.arrayBuffer(),
            contentType: response.headers.get("content-type"),
            disposition: response.headers.get("content-disposition"),
        };
    }
}
