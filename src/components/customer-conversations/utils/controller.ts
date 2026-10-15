import type {
    CustomerConversationPage,
    CustomerConversationRow,
    CustomerConversationState,
    CustomerReadAck,
} from "../types";

type Transport = {
    page(token: string, before?: string): Promise<CustomerConversationPage>;
    read(token: string, id: string, lastMessageId: number, readRevision?: number): Promise<CustomerReadAck>;
};
const asError = (error: unknown) =>
    error instanceof Error
        ? error
        : new Error("문의 목록을 불러오지 못했습니다.");
function mergeRows(...groups: CustomerConversationRow[][]) {
    const rows = new Map<string, CustomerConversationRow>();
    for (const group of groups)
        for (const row of group) if (!rows.has(row.id)) rows.set(row.id, row);
    return [...rows.values()].sort(
        (a, b) =>
            b.lastMessageAt.localeCompare(a.lastMessageAt) ||
            b.id.localeCompare(a.id),
    );
}

/** One instance per channel/member. Authentication remains on the server. */
export class CustomerConversationController {
    #state: CustomerConversationState = {
        view: "current",
        rows: [],
        hasMore: false,
        loading: false,
    };
    #listeners = new Set<() => void>();
    #token = "";
    #generation = 0;
    #nextBefore: string | null = null;
    #expanded = false;
    #first?: Promise<unknown>;
    #more?: Promise<unknown>;
    #reads = new Map<string, number>();
    #readPending = new Map<string, Promise<unknown>>();

    constructor(private readonly transport: Transport) {}
    getSnapshot = () => this.#state;
    subscribe = (listener: () => void) => {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    };
    #set(patch: Partial<CustomerConversationState>) {
        this.#state = { ...this.#state, ...patch };
        for (const listener of this.#listeners) listener();
    }
    activate(token: string) {
        this.#token = token;
        this.#generation++;
        this.#first = this.#more = undefined;
        this.#readPending.clear();
        this.#set({ loading: false });
    }
    deactivate() {
        this.#token = "";
        this.#generation++;
        this.#first = this.#more = undefined;
        this.#readPending.clear();
    }
    showList = () => this.#set({ view: "list" });
    newInquiry = () => this.#set({ view: "new", conversationId: undefined });
    open = (id: string) =>
        this.#set({ view: "thread", conversationId: id });
    reset = () => this.#set({ view: "current", conversationId: undefined });

    refresh = (): Promise<unknown> => {
        if (!this.#token) return Promise.resolve();
        if (this.#first) return this.#first;
        const generation = this.#generation;
        this.#set({ loading: true });
        const request = this.transport
            .page(this.#token)
            .then((page) => {
                if (generation !== this.#generation) return;
                this.#set({
                    rows: this.#expanded
                        ? mergeRows(page.rows, this.#state.rows)
                        : page.rows,
                    unreadCount: page.unreadCount,
                    hasMore: this.#expanded ? this.#state.hasMore : page.hasMore,
                    error: undefined,
                });
                if (!this.#expanded) this.#nextBefore = page.nextBefore;
                return page;
            })
            .catch((error: unknown) => {
                if (generation === this.#generation)
                    this.#set({ error: asError(error) });
            })
            .finally(() => {
                if (this.#first === request) {
                    this.#first = undefined;
                    this.#set({ loading: !!this.#more });
                }
            });
        this.#first = request;
        return request;
    };
    loadMore = (): Promise<unknown> => {
        if (!this.#token || !this.#state.hasMore || !this.#nextBefore)
            return Promise.resolve();
        if (this.#more) return this.#more;
        // Keep the cursor stable until a pending first-page refresh has settled.
        if (this.#first) return this.#first.then(() => this.loadMore());
        const generation = this.#generation;
        this.#set({ loading: true });
        const request = this.transport
            .page(this.#token, this.#nextBefore)
            .then((page) => {
                if (generation !== this.#generation) return;
                this.#expanded = true;
                this.#nextBefore = page.nextBefore;
                this.#set({
                    rows: mergeRows(this.#state.rows, page.rows),
                    unreadCount: page.unreadCount,
                    hasMore: page.hasMore,
                    error: undefined,
                });
                return page;
            })
            .catch((error: unknown) => {
                if (generation === this.#generation)
                    this.#set({ error: asError(error) });
            })
            .finally(() => {
                if (this.#more === request) {
                    this.#more = undefined;
                    this.#set({ loading: !!this.#first });
                }
            });
        this.#more = request;
        return request;
    };
    markSeen = (id: string, lastMessageId: number, readRevision?: number): Promise<unknown> => {
        if (!this.#token || !Number.isSafeInteger(lastMessageId) || lastMessageId < 1)
            return Promise.resolve();
        const context = `${id}:${readRevision ?? "legacy"}`;
        if ((this.#reads.get(context) ?? 0) >= lastMessageId)
            return Promise.resolve();
        const key = `${context}:${lastMessageId}`;
        const pending = this.#readPending.get(key);
        if (pending) return pending;
        const generation = this.#generation;
        const request = this.transport
            .read(this.#token, id, lastMessageId, readRevision)
            .then((result) => {
                if (generation !== this.#generation) return;
                this.#reads.set(context, Math.max(this.#reads.get(context) ?? 0, lastMessageId));
                this.#set({
                    rows: this.#state.rows.map((row) => row.id === id ? { ...row, unread: result.unread } : row),
                });
                void this.refresh();
                return result;
            })
            .finally(() => {
                if (this.#readPending.get(key) === request)
                    this.#readPending.delete(key);
            });
        this.#readPending.set(key, request);
        return request;
    };
}
