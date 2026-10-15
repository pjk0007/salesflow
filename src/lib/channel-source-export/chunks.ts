import { createHash } from "node:crypto";
import { normalizeImport } from "@/lib/customer-imports/adapters";
import {
    createImportInput, date, fingerprint, kinds,
    type ImportInput, type ImportKind,
} from "@/lib/customer-imports/rules";

export const CHANNEL_IMPORT_LIMITS = { maxRows: 10_000, maxCharacters: 5_000_000, maxBytes: 20_000_000 } as const;
const collections = ["users", "managers", "bots", "userChats", "messages"] as const;
type Collection = (typeof collections)[number];
type Entity = Record<string, unknown>;
export type ChannelChunkBundle = Record<Collection, Entity[]> & { hasNext: boolean };
export type ChannelImportCounts = Record<ImportKind, number>;
export type ChannelRawCounts = Record<Collection, number>;
export type ChannelImportChunk = {
    fileName: string;
    phase: "contacts" | "conversations" | "messages";
    bundle: ChannelChunkBundle;
    input: ImportInput;
    expectedCounts: ChannelImportCounts;
    primaryCounts: ChannelImportCounts;
    dependencyCounts: ChannelImportCounts;
    rawCounts: ChannelRawCounts;
    normalizedRows: number;
    characters: number;
    bytes: number;
    sha256: string;
    warnings: string[];
};
export type ChannelChunkPlan = {
    chunks: ChannelImportChunk[];
    manifest: {
        formatVersion: 1;
        source: "channel";
        namespace: string;
        workspaceId: number;
        limits: { maxRows: number; maxCharacters: number; maxBytes: number };
        uniqueCounts: ChannelImportCounts;
        importedCounts: ChannelImportCounts;
        dependencyCounts: ChannelImportCounts;
        rawUniqueCounts: ChannelRawCounts;
        duplicateRawCounts: ChannelRawCounts;
        rawOccurrences: ChannelRawCounts;
        limitations: string[];
        warnings: string[];
    };
};
export class ChannelChunkError extends Error {
    constructor(
        readonly code: "source_incomplete" | "source_invalid" | "duplicate_source" | "missing_dependency" | "row_invalid" | "item_too_large",
        readonly detail: { kind?: string; sourceId?: string; dependencyKind?: string; dependencyId?: string; issues?: string[] } = {},
    ) {
        super(`채널톡 가져오기 자료 분할을 완료하지 못했습니다 (${code}).`);
        this.name = "ChannelChunkError";
    }
}
const zero = (): ChannelImportCounts => Object.fromEntries(kinds.map(kind => [kind, 0])) as ChannelImportCounts;
const zeroRaw = (): ChannelRawCounts => Object.fromEntries(collections.map(kind => [kind, 0])) as ChannelRawCounts;
const empty = (): ChannelChunkBundle => ({ users: [], managers: [], bots: [], userChats: [], messages: [], hasNext: false });
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sourceId = (entity: Entity, kind: Collection) => {
    if (typeof entity.id !== "string" || !entity.id) throw new ChannelChunkError("source_invalid", { kind });
    if (kind === "messages") {
        if (typeof entity.chatId !== "string" || !entity.chatId) throw new ChannelChunkError("missing_dependency", { kind, sourceId: entity.id, dependencyKind: "userChats" });
        return `${entity.chatId}/${entity.id}`;
    }
    return entity.id;
};
const normalizedKind = (kind: Collection): ImportKind | undefined =>
    kind === "users" ? "contacts" : kind === "userChats" ? "conversations" : kind === "messages" ? "messages" : undefined;
type RecordItem = { kind: Collection; id: string; raw: Entity; serialized: string; bytes: number };

/** importer에 실제로 들어갈 행과 JSON 크기를 기준으로 의존 관계를 보존해 분할한다. */
export function splitChannelBundle(
    raw: unknown,
    options: { workspaceId: number; namespace: string; maxRows?: number; maxCharacters?: number; maxBytes?: number },
): ChannelChunkPlan {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ChannelChunkError("source_invalid");
    const source = raw as Record<string, unknown>;
    if (source.hasNext !== false || source.next || source.nextCursor) throw new ChannelChunkError("source_incomplete");
    const baseInput = createImportInput.parse({ workspaceId: options.workspaceId, namespace: options.namespace, source: "channel", format: "json", content: "{}" });
    const limits = {
        maxRows: options.maxRows ?? CHANNEL_IMPORT_LIMITS.maxRows,
        maxCharacters: options.maxCharacters ?? CHANNEL_IMPORT_LIMITS.maxCharacters,
        maxBytes: options.maxBytes ?? CHANNEL_IMPORT_LIMITS.maxBytes,
    };
    for (const key of Object.keys(limits) as (keyof typeof limits)[])
        if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > CHANNEL_IMPORT_LIMITS[key]) throw new ChannelChunkError("source_invalid", { kind: key });
    const records = Object.fromEntries(collections.map(kind => [kind, new Map<string, RecordItem>()])) as Record<Collection, Map<string, RecordItem>>;
    const duplicateRawCounts = zeroRaw();
    for (const kind of collections) {
        if (!Array.isArray(source[kind])) throw new ChannelChunkError("source_invalid", { kind });
        for (const value of source[kind] as unknown[]) {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChannelChunkError("source_invalid", { kind });
            const entity = value as Entity, id = sourceId(entity, kind);
            let serialized: string;
            try { serialized = JSON.stringify(entity); } catch { throw new ChannelChunkError("source_invalid", { kind, sourceId: id }); }
            const previous = records[kind].get(id);
            if (previous) {
                if (fingerprint(previous.raw) !== fingerprint(entity)) throw new ChannelChunkError("duplicate_source", { kind, sourceId: id });
                duplicateRawCounts[kind]++;
                continue;
            }
            records[kind].set(id, { kind, id, raw: entity, serialized, bytes: Buffer.byteLength(serialized) });
        }
    }
    const requireRecord = (kind: Collection, id: unknown, owner: RecordItem) => {
        const found = typeof id === "string" ? records[kind].get(id) : undefined;
        if (!found) throw new ChannelChunkError("missing_dependency", { kind: owner.kind, sourceId: owner.id, dependencyKind: kind, dependencyId: typeof id === "string" ? id : undefined });
        return found;
    };
    const dependencies = (item: RecordItem): RecordItem[] => {
        if (item.kind === "users") return [item];
        const chat = item.kind === "userChats" ? item : requireRecord("userChats", item.raw.chatId, item);
        const user = requireRecord("users", chat.raw.userId, chat);
        if (item.kind === "userChats") return [user, chat];
        const result = [user, chat];
        const actorKind = item.raw.personType === "user" ? "users" : item.raw.personType === "manager" ? "managers" : item.raw.personType === "bot" ? "bots" : undefined;
        if (actorKind) result.push(requireRecord(actorKind, item.raw.personId, item));
        return [...result, item];
    };
    const phases = [
        ["contacts", [...records.users.values()].sort((a, b) => compare(a.id, b.id))],
        ["conversations", [...records.userChats.values()].sort((a, b) => compare(a.id, b.id))],
        ["messages", [...records.messages.values()].sort((a, b) => compare(String(a.raw.chatId), String(b.raw.chatId)) || compare(date(a.raw.createdAt) ?? "", date(b.raw.createdAt) ?? "") || compare(a.id, b.id))],
    ] as const;
    const chunks: ChannelImportChunk[] = [];
    const importedCounts = zero(), dependencyCounts = zero(), rawOccurrences = zeroRaw(), uniqueCounts = zero();
    uniqueCounts.contacts = records.users.size;
    uniqueCounts.conversations = records.userChats.size;
    uniqueCounts.messages = records.messages.size;
    const emptyJson = JSON.stringify(empty());
    for (const [phase, items] of phases) {
        let bundle = empty(), keys = new Set<string>(), characters = emptyJson.length, bytes = Buffer.byteLength(emptyJson), rows = 0, primaries = zero();
        const flush = () => {
            if (!rows) return;
            const content = JSON.stringify(bundle), expectedCounts = zero();
            expectedCounts.contacts = bundle.users.length;
            expectedCounts.conversations = bundle.userChats.length;
            expectedCounts.messages = bundle.messages.length;
            const input = createImportInput.parse({ ...baseInput, content, expectedCounts });
            const checked = normalizeImport(input);
            const invalid = checked.rows.find(row => row.errors.length);
            if (checked.errors.length || invalid) throw new ChannelChunkError("row_invalid", { kind: invalid?.kind, sourceId: invalid?.sourceId, issues: invalid?.errors ?? checked.errors });
            if (checked.rows.length !== rows || content.length !== characters || Buffer.byteLength(content) !== bytes) throw new ChannelChunkError("source_invalid", { kind: phase });
            const dependencies = zero(), rawCounts = zeroRaw();
            for (const kind of kinds) {
                dependencies[kind] = expectedCounts[kind] - primaries[kind];
                importedCounts[kind] += expectedCounts[kind];
                dependencyCounts[kind] += dependencies[kind];
            }
            for (const kind of collections) { rawCounts[kind] = bundle[kind].length; rawOccurrences[kind] += rawCounts[kind]; }
            chunks.push({ fileName: `${String(chunks.length + 1).padStart(5, "0")}-${phase}.json`, phase, bundle, input, expectedCounts, primaryCounts: primaries, dependencyCounts: dependencies, rawCounts, normalizedRows: rows, characters, bytes, sha256: createHash("sha256").update(content).digest("hex"), warnings: checked.warnings });
            bundle = empty(); keys = new Set(); characters = emptyJson.length; bytes = Buffer.byteLength(emptyJson); rows = 0; primaries = zero();
        };
        for (const item of items) {
            const closure = dependencies(item);
            const additions = () => {
                const seen = new Set(keys), next: RecordItem[] = [];
                for (const entry of closure) { const key = `${entry.kind}:${entry.id}`; if (!seen.has(key)) { seen.add(key); next.push(entry); } }
                const counts = zeroRaw();
                let moreCharacters = 0, moreBytes = 0, moreRows = 0;
                for (const entry of next) {
                    const comma = bundle[entry.kind].length + counts[entry.kind]++ > 0 ? 1 : 0;
                    moreCharacters += entry.serialized.length + comma;
                    moreBytes += entry.bytes + comma;
                    if (normalizedKind(entry.kind)) moreRows++;
                }
                return { next, moreCharacters, moreBytes, moreRows };
            };
            let extra = additions();
            const fits = () => rows + extra.moreRows <= limits.maxRows && characters + extra.moreCharacters <= limits.maxCharacters && bytes + extra.moreBytes <= limits.maxBytes;
            if (!fits()) { flush(); extra = additions(); }
            if (!fits()) throw new ChannelChunkError("item_too_large", { kind: item.kind, sourceId: item.id });
            for (const entry of extra.next) { bundle[entry.kind].push(entry.raw); keys.add(`${entry.kind}:${entry.id}`); }
            rows += extra.moreRows; characters += extra.moreCharacters; bytes += extra.moreBytes;
            primaries[normalizedKind(item.kind)!]++;
        }
        flush();
    }
    return { chunks, manifest: { formatVersion: 1, source: "channel", namespace: baseInput.namespace, workspaceId: baseInput.workspaceId, limits, uniqueCounts, importedCounts, dependencyCounts, rawUniqueCounts: Object.fromEntries(collections.map(kind => [kind, records[kind].size])) as ChannelRawCounts, duplicateRawCounts, rawOccurrences, warnings: [...new Set(chunks.flatMap(chunk => chunk.warnings))], limitations: ["각 파일을 순서대로 같은 원본 계정 이름(namespace)으로 가져오세요. 고객·상담 의존 행과 작성자 자료가 반복됩니다.", "첨부는 원본 정보만 포함합니다. 파일 원본 백업/연결 완료와 고객 공개 여부는 별도입니다.", "수집한 상담에 연결된 고객만 포함할 수 있으며 전체 고객·계정·권한·보존 범위의 완전성을 증명하지 않습니다."] } };
}
