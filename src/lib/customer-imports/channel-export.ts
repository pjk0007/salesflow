/** Read-only collection for the public 2026-06-01 contract. No credentials or I/O. */
export const CHANNEL_EXPORT_VERSION = "2026-06-01" as const;
export const CHANNEL_EXPORT_STATES = [
    "opened", "closed", "snoozed", "queued", "initial", "missed",
] as const;
export type ChannelRawEntity = Record<string, unknown>;
export type ChannelExportStatus = "complete" | "incomplete" | "failed" | "aborted";
export type ChannelExportBundle = {
    users: ChannelRawEntity[];
    managers: ChannelRawEntity[];
    userChats: ChannelRawEntity[];
    messages: ChannelRawEntity[];
    bots: ChannelRawEntity[];
    /** Prevent the import adapter from accepting a partial collection. */
    hasNext: boolean;
};
export type ChannelExportFailure = {
    code: string;
    endpoint: string;
    status?: number;
};
export type ChannelExportLedger = {
    path: string;
    query: Record<string, string | number>;
    status: "pending" | "complete" | "failed";
    /** Next uncommitted page. Null means the initial page, unless complete. */
    cursor: string | null;
    seenCursors: (string | null)[];
    pages: number;
    failure?: ChannelExportFailure;
};
export type ChannelExportCheckpoint = {
    schemaVersion: 1;
    apiVersion: typeof CHANNEL_EXPORT_VERSION;
    channelId: string;
    pageSize: number;
    requestCount: number;
    status: ChannelExportStatus;
    bundle: ChannelExportBundle;
    ledger: Record<string, ChannelExportLedger>;
    failure?: ChannelExportFailure;
};
export type ChannelExportRequest = {
    method: "GET";
    path: string;
    query: Record<string, string | number>;
    headers: { "Channel-Version": typeof CHANNEL_EXPORT_VERSION };
    timeoutMs: number;
    signal: AbortSignal;
};
export type ChannelExportResponse = {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
};
export type ChannelExportLimits = {
    pageSize: number;
    maxRequests: number;
    maxEntities: number;
    maxPagesPerEndpoint: number;
    maxAttempts: number;
    timeoutMs: number;
    minRequestIntervalMs: number;
    retryBaseMs: number;
    retryMaxMs: number;
};
export type ChannelExportOptions = {
    channelId: string;
    /** Implement authentication and response JSON parsing outside this module. */
    request: (request: ChannelExportRequest) => Promise<ChannelExportResponse>;
    sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
    /** Atomically persist the whole snapshot; failure stops collection. */
    checkpoint?: (state: ChannelExportCheckpoint) => Promise<void>;
    /** Default 1. Raw pages must be durably archived separately before increasing this. */
    checkpointEveryRequests?: number;
    resume?: ChannelExportCheckpoint;
    limits?: Partial<ChannelExportLimits>;
    signal?: AbortSignal;
    now?: () => number;
};
export type ChannelExportResult = {
    status: ChannelExportStatus;
    bundle: ChannelExportBundle;
    checkpoint: ChannelExportCheckpoint;
    counts: Record<"users" | "managers" | "userChats" | "messages" | "bots" | "attachments", number>;
    limitations: readonly string[];
};
/** Only these transport failures are retried; do not pass secret-bearing messages. */
export class ChannelExportTransportError extends Error {
    constructor(public readonly code: "timeout" | "network") {
        super(code);
        this.name = "ChannelExportTransportError";
    }
}

const collections = ["users", "managers", "userChats", "messages", "bots"] as const;
type Collection = typeof collections[number];
type EntityIndex = Record<Collection, Map<string, string>>;
type Task = { key: string; path: string; query: Record<string, string | number>; collection: Collection; id?: string };
const defaults: ChannelExportLimits = {
    pageSize: 100, maxRequests: 50_000, maxEntities: 200_000,
    maxPagesPerEndpoint: 10_000, maxAttempts: 3, timeoutMs: 30_000,
    minRequestIntervalMs: 110, retryBaseMs: 500, retryMaxMs: 60_000,
};
const ceilings: ChannelExportLimits = {
    pageSize: 500, maxRequests: 100_000, maxEntities: 250_000,
    maxPagesPerEndpoint: 20_000, maxAttempts: 5, timeoutMs: 60_000,
    minRequestIntervalMs: 60_000, retryBaseMs: 60_000, retryMaxMs: 120_000,
};
const limitations = [
    "Only chats exposed by the documented list endpoints and their referenced users are collected; this is not all customers.",
    "Completion means all selected endpoint cursors ended, not a consistent point-in-time snapshot or proof of API permissions/retention coverage.",
    "Attachment metadata only: signed URLs, file bytes, and download completeness are not collected.",
] as const;
class Stop extends Error {
    constructor(public readonly code: string, public readonly httpStatus?: number) {
        super(code);
    }
}
function object(value: unknown): ChannelRawEntity {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Stop("invalid_response");
    return value as ChannelRawEntity;
}
function id(value: unknown): string {
    if (typeof value !== "string" || !value || value.length > 2048) throw new Stop("invalid_entity_id");
    return value;
}
function canonical(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    const record = object(value);
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
function clone<T>(value: T): T { return structuredClone(value); }
function emptyBundle(): ChannelExportBundle {
    return { users: [], managers: [], userChats: [], messages: [], bots: [], hasNext: true };
}
function entityKey(kind: Collection, entity: ChannelRawEntity) {
    return kind === "messages" ? JSON.stringify([id(entity.chatId), id(entity.id)]) : id(entity.id);
}
function indexBundle(bundle: ChannelExportBundle): EntityIndex {
    return Object.fromEntries(collections.map(kind => [kind, new Map(bundle[kind].map(value => [entityKey(kind, value), canonical(value)]))])) as EntityIndex;
}
function mergeBundle(
    current: ChannelExportBundle, incoming: Partial<Record<Collection, unknown>>,
    channelId: string, maxEntities: number, index = indexBundle(current),
): ChannelExportBundle {
    const staged = new Map<Collection, Map<string, { content: string; value: ChannelRawEntity }>>();
    let count = collections.reduce((total, kind) => total + current[kind].length, 0);
    for (const kind of collections) {
        const input = incoming[kind];
        if (input === undefined) continue;
        if (!Array.isArray(input)) throw new Stop("invalid_response");
        const additions = new Map<string, { content: string; value: ChannelRawEntity }>();
        staged.set(kind, additions);
        for (const raw of input) {
            const value = object(raw), key = entityKey(kind, value), content = canonical(value);
            if (value.channelId !== channelId) throw new Stop("channel_mismatch");
            if (kind === "messages" && value.chatType !== "userChat") throw new Stop("invalid_message_chat_type");
            const prior = additions.get(key)?.content ?? index[kind].get(key);
            if (prior !== undefined) {
                if (prior !== content) throw new Stop(`conflicting_${kind}_id`);
                continue;
            }
            if (++count > maxEntities) throw new Stop("entity_limit");
            additions.set(key, { content, value: clone(value) });
        }
    }
    // Commit indexes and rows only after every collection in the page validates.
    const result = { ...current };
    for (const [kind, additions] of staged) {
        if (!additions.size) continue;
        result[kind] = current[kind].concat([...additions.values()].map(item => item.value));
        for (const [key, item] of additions) index[kind].set(key, item.content);
    }
    return result;
}
function baseTasks(pageSize: number): Task[] {
    return [
        { key: "managers", path: "/open/managers", query: { limit: pageSize }, collection: "managers" },
        ...CHANNEL_EXPORT_STATES.map(state => ({
            key: `chats:${state}`, path: "/open/user-chats", collection: "userChats" as const,
            query: { state, dateTimeFieldName: "deskUpdatedAt", sortOrder: "asc", limit: pageSize },
        })),
    ];
}
const channelTask: Task = { key: "channel", path: "/open/channel", query: {}, collection: "users" };
function messageTasks(bundle: ChannelExportBundle, pageSize: number): Task[] {
    return bundle.userChats.map(chat => {
        const chatId = id(chat.id);
        return { key: `messages:${chatId}`, path: `/open/user-chats/${encodeURIComponent(chatId)}/messages`, query: { sortOrder: "asc", limit: pageSize }, collection: "messages", id: chatId };
    });
}
function userTasks(bundle: ChannelExportBundle): Task[] {
    const ids = new Set<string>();
    for (const chat of bundle.userChats) if (chat.userId !== undefined && chat.userId !== null) ids.add(id(chat.userId));
    for (const message of bundle.messages) if (message.personType === "user") ids.add(id(message.personId));
    return [...ids].sort().map(userId => ({ key: `user:${userId}`, path: `/open/users/${encodeURIComponent(userId)}`, query: {}, collection: "users", id: userId }));
}
function initialLedger(task: Task): ChannelExportLedger {
    return { path: task.path, query: task.query, status: "pending", cursor: null, seenCursors: [], pages: 0 };
}
function restore(options: ChannelExportOptions, limits: ChannelExportLimits): ChannelExportCheckpoint {
    if (!options.resume) return {
        schemaVersion: 1, apiVersion: CHANNEL_EXPORT_VERSION, channelId: options.channelId,
        pageSize: limits.pageSize, requestCount: 0, status: "incomplete",
        bundle: emptyBundle(), ledger: {},
    };
    const state = clone(options.resume);
    if (state.schemaVersion !== 1 || state.apiVersion !== CHANNEL_EXPORT_VERSION || state.channelId !== options.channelId || state.pageSize !== limits.pageSize || !Number.isSafeInteger(state.requestCount) || state.requestCount < 0) throw new TypeError("Invalid or incompatible Channel export checkpoint");
    if (!["complete", "incomplete", "failed", "aborted"].includes(state.status) || typeof state.bundle?.hasNext !== "boolean" || state.bundle.hasNext !== (state.status !== "complete")) throw new TypeError("Invalid checkpoint completion status");
    for (const kind of collections) if (!Array.isArray(state.bundle?.[kind])) throw new TypeError("Invalid checkpoint bundle");
    state.bundle = mergeBundle(emptyBundle(), state.bundle, options.channelId, limits.maxEntities);
    const expected = new Map([channelTask, ...baseTasks(limits.pageSize), ...messageTasks(state.bundle, limits.pageSize), ...userTasks(state.bundle)].map(task => [task.key, task]));
    for (const [key, entry] of Object.entries(object(state.ledger))) {
        const item = object(entry) as ChannelExportLedger, task = expected.get(key);
        if (!task || item.path !== task.path || canonical(item.query) !== canonical(task.query) || !["pending", "complete", "failed"].includes(item.status) || !Array.isArray(item.seenCursors) || item.pages !== item.seenCursors.length || !Number.isSafeInteger(item.pages) || item.pages < 0 || !item.seenCursors.every(cursor => cursor === null || (typeof cursor === "string" && !!cursor && cursor.length <= 16384)) || new Set(item.seenCursors).size !== item.seenCursors.length || !(item.cursor === null || (typeof item.cursor === "string" && !!item.cursor && item.cursor.length <= 16384)) || (item.status === "complete" ? item.cursor !== null || item.pages < 1 : item.seenCursors.includes(item.cursor))) throw new TypeError("Invalid checkpoint ledger");
        if ((item.pages > 0 && item.seenCursors[0] !== null) || (item.pages === 0 && item.cursor !== null)) throw new TypeError("Invalid checkpoint initial cursor");
        if (item.status === "failed") item.status = "pending";
        delete item.failure;
    }
    state.status = "incomplete";
    delete state.failure;
    return state;
}
function header(headers: Record<string, string> | undefined, name: string) {
    return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
}
function retryDelay(response: ChannelExportResponse | undefined, attempt: number, limits: ChannelExportLimits, now: number) {
    const retry = header(response?.headers, "retry-after"), reset = header(response?.headers, "x-ratelimit-reset");
    let wait = Math.min(limits.retryBaseMs * 2 ** attempt, limits.retryMaxMs);
    if (retry) {
        const seconds = Number(retry);
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now;
        if (Number.isFinite(requested)) wait = Math.max(wait, requested);
    } else if (response?.status === 429 && reset && Number.isFinite(Number(reset))) {
        wait = Math.max(wait, Number(reset) * 1000 - now);
    }
    if (wait > limits.retryMaxMs) throw new Stop("retry_delay_limit", response?.status);
    return Math.max(0, Math.ceil(wait));
}

export async function exportChannelData(options: ChannelExportOptions): Promise<ChannelExportResult> {
    id(options.channelId);
    const limits = { ...defaults, ...options.limits, pageSize: options.limits?.pageSize ?? options.resume?.pageSize ?? defaults.pageSize };
    for (const key of Object.keys(defaults) as (keyof ChannelExportLimits)[]) {
        const minimum = key.endsWith("Ms") && key !== "timeoutMs" ? 0 : 1;
        if (!Number.isSafeInteger(limits[key]) || limits[key] < minimum || limits[key] > ceilings[key]) throw new TypeError(`Invalid export limit: ${key}`);
    }
    if (limits.retryBaseMs > limits.retryMaxMs) throw new TypeError("retryBaseMs exceeds retryMaxMs");
    const checkpointEvery = options.checkpointEveryRequests ?? 1;
    if (!Number.isSafeInteger(checkpointEvery) || checkpointEvery < 1 || checkpointEvery > 100) throw new TypeError("Invalid checkpoint interval");
    const state = restore(options, limits), entityIndex = indexBundle(state.bundle);
    let lastSavedRequest = -Infinity;
    let currentTask: Task | undefined;
    const abort = () => { if (options.signal?.aborted) throw new Stop("aborted"); };
    async function save(force = false) {
        if (checkpointEvery > 1 && !force && state.requestCount - lastSavedRequest < checkpointEvery) return;
        try { await options.checkpoint?.(clone(state)); lastSavedRequest = state.requestCount; }
        catch { throw new Stop("checkpoint_failed"); }
    }
    async function sleep(ms: number) {
        abort();
        try { await options.sleep(ms, options.signal); }
        catch { abort(); throw new Stop("sleep_failed"); }
        abort();
    }
    async function request(task: Task, cursor: string | null): Promise<ChannelRawEntity> {
        for (let attempt = 0; attempt < limits.maxAttempts; attempt++) {
            abort();
            if (state.requestCount >= limits.maxRequests) throw new Stop("request_limit");
            if (state.requestCount && limits.minRequestIntervalMs) await sleep(limits.minRequestIntervalMs);
            state.requestCount++;
            const controller = new AbortController();
            let timer: ReturnType<typeof setTimeout> | undefined;
            let timedOut = false;
            const cancel = () => controller.abort();
            options.signal?.addEventListener("abort", cancel, { once: true });
            let response: ChannelExportResponse | undefined, transportFailure: string | undefined;
            try {
                const deadline = new Promise<never>((_, reject) => {
                    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new ChannelExportTransportError("timeout")); }, limits.timeoutMs);
                    controller.signal.addEventListener("abort", () => { if (options.signal?.aborted) reject(new Stop("aborted")); }, { once: true });
                });
                response = await Promise.race([
                    options.request({ method: "GET", path: task.path, query: { ...task.query, ...(cursor === null ? {} : { cursor }) }, headers: { "Channel-Version": CHANNEL_EXPORT_VERSION }, timeoutMs: limits.timeoutMs, signal: controller.signal }),
                    deadline,
                ]);
            } catch (error) {
                abort();
                if (timedOut) transportFailure = "timeout";
                else if (error instanceof ChannelExportTransportError) transportFailure = error.code;
                else if (error instanceof Stop) throw error;
                else throw new Stop("transport_failed");
            } finally {
                clearTimeout(timer);
                options.signal?.removeEventListener("abort", cancel);
            }
            abort();
            if (response?.status === 401 || response?.status === 403) throw new Stop("authentication_failed", response.status);
            if (response?.status === 200) return object(response.body);
            const transient = transportFailure || response?.status === 429 || [500, 502, 503, 504].includes(response?.status ?? 0);
            if (!transient) throw new Stop("http_failed", response?.status);
            if (attempt + 1 === limits.maxAttempts) throw new Stop(transportFailure ?? "retries_exhausted", response?.status);
            await sleep(retryDelay(response, attempt, limits, (options.now ?? Date.now)()));
        }
        throw new Stop("retries_exhausted");
    }
    async function collect(task: Task) {
        currentTask = task;
        const entry = state.ledger[task.key] ?? (state.ledger[task.key] = initialLedger(task));
        while (entry.status !== "complete") {
            abort();
            if (entry.pages >= limits.maxPagesPerEndpoint) throw new Stop("page_limit");
            const body = await request(task, entry.cursor);
            let next: string | null = null;
            const incoming: Partial<Record<Collection, unknown>> = {};
            if (task.key.startsWith("user:")) {
                const user = object(body.user);
                if (user.id !== task.id) throw new Stop("user_response_mismatch");
                incoming.users = [user];
            } else {
                if (typeof body.hasNext !== "boolean" || !(body.nextCursor === null || (typeof body.nextCursor === "string" && !!body.nextCursor && body.nextCursor.length <= 16384)) || body.hasNext !== (body.nextCursor !== null)) throw new Stop("invalid_pagination");
                next = body.nextCursor as string | null;
                if (next !== null && (next === entry.cursor || entry.seenCursors.includes(next))) throw new Stop("cursor_loop");
                if (!Array.isArray(body[task.collection])) throw new Stop("invalid_response");
                for (const kind of collections) if (body[kind] !== undefined) incoming[kind] = body[kind];
                if (task.collection === "messages" && (body.messages as unknown[]).some(message => object(message).chatId !== task.id)) throw new Stop("message_response_mismatch");
            }
            // Validate/deduplicate the entire page before advancing any cursor.
            const bundle = mergeBundle(state.bundle, incoming, options.channelId, limits.maxEntities, entityIndex);
            state.bundle = bundle;
            entry.seenCursors.push(entry.cursor);
            entry.pages++;
            entry.cursor = next;
            entry.status = next === null ? "complete" : "pending";
            await save();
        }
    }
    try {
        // Credentials belong to the injected transport; verify their channel on every run.
        currentTask = channelTask;
        state.ledger.channel = initialLedger(channelTask);
        const channel = object((await request(channelTask, null)).channel);
        if (channel.id !== options.channelId) throw new Stop("channel_mismatch");
        state.ledger.channel = { ...initialLedger(channelTask), status: "complete", pages: 1, seenCursors: [null] };
        for (const task of baseTasks(limits.pageSize)) state.ledger[task.key] ??= initialLedger(task);
        await save(true);
        for (const task of baseTasks(limits.pageSize)) await collect(task);
        for (const task of messageTasks(state.bundle, limits.pageSize)) state.ledger[task.key] ??= initialLedger(task);
        await save();
        for (const task of messageTasks(state.bundle, limits.pageSize)) await collect(task);
        for (const task of userTasks(state.bundle)) state.ledger[task.key] ??= initialLedger(task);
        await save();
        for (const task of userTasks(state.bundle)) await collect(task);
        const chatIds = new Set(state.bundle.userChats.map(chat => chat.id));
        if (state.bundle.messages.some(message => !chatIds.has(message.chatId))) throw new Stop("orphan_message");
        abort();
        state.status = "complete";
        state.bundle.hasNext = false;
        await save(true);
    } catch (error) {
        const failure: ChannelExportFailure = { code: error instanceof Stop ? error.code : "collection_failed", endpoint: currentTask?.key ?? "checkpoint", ...(error instanceof Stop && error.httpStatus !== undefined ? { status: error.httpStatus } : {}) };
        state.status = failure.code === "aborted" ? "aborted" : ["request_limit", "entity_limit", "page_limit"].includes(failure.code) ? "incomplete" : "failed";
        state.bundle.hasNext = true;
        state.failure = failure;
        if (currentTask && state.ledger[currentTask.key].status !== "complete") {
            state.ledger[currentTask.key].status = "failed";
            state.ledger[currentTask.key].failure = failure;
        }
        if (failure.code !== "checkpoint_failed") {
            try { await save(true); }
            catch { state.failure = { code: "checkpoint_failed", endpoint: "checkpoint" }; state.status = "failed"; }
        }
    }
    const result = clone(state);
    return {
        status: result.status, bundle: result.bundle, checkpoint: result,
        counts: { users: result.bundle.users.length, managers: result.bundle.managers.length, userChats: result.bundle.userChats.length, messages: result.bundle.messages.length, bots: result.bundle.bots.length, attachments: result.bundle.messages.reduce((count, message) => count + (Array.isArray(message.files) ? message.files.length : 0), 0) },
        limitations: checkpointEvery > 1 ? [...limitations, `Whole snapshots are saved every ${checkpointEvery} requests; interruption may re-read up to ${checkpointEvery - 1} requests. Raw-page archival must remain enabled.`] : limitations,
    };
}
