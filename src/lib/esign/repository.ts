import { EsignError, type EsignDocument, type EsignEnvelope, type EsignRecipient, type EsignEvent, type EsignJob, type EsignActor, type EsignListPage, type EsignListQuery } from "./types";
export type EsignAggregate = { envelope: EsignEnvelope; recipients: EsignRecipient[]; events: EsignEvent[]; jobs: EsignJob[] };
export type EsignListAggregate = { envelope: Omit<EsignEnvelope, "document">; recipients: EsignRecipient[] };

export const ESIGN_LIST_LIMIT = { default: 50, max: 100 } as const;
/** 목록 경계: 마지막 항목의 (createdAt, id). 클라이언트에는 불투명 문자열로만 준다. */
export function encodeListCursor(item: { createdAt: string; id: string }) {
    return Buffer.from(JSON.stringify([item.createdAt, item.id])).toString("base64url");
}
export function decodeListCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
    if (!cursor) return null;
    try {
        const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown[];
        if (typeof createdAt === "string" && Number.isFinite(Date.parse(createdAt)) && typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) return { createdAt, id };
    } catch { /* 아래 공통 오류 */ }
    throw new EsignError("목록 위치가 올바르지 않습니다. 처음부터 다시 불러와 주세요.", 400, "invalid_cursor");
}
export function listLimit(limit: number | undefined) {
    return Number.isSafeInteger(limit) && limit! > 0 ? Math.min(ESIGN_LIST_LIMIT.max, limit!) : ESIGN_LIST_LIMIT.default;
}
export function normalizedSearch(query: string | undefined) {
    const value = query?.trim().slice(0, 100);
    return value ? value : null;
}
/** 같은 createdAt이면 id 내림차순 — postgres ORDER BY created_at DESC, id DESC와 같은 순서. */
export function compareNewestFirst(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) {
    return Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
/** Callback is synchronous: network, file operations and rendering must run outside this transaction. */
export interface EsignRepository {
    saveDocument(document: EsignDocument, expectedVersion?: number): Promise<void>;
    document(actor: EsignActor, id: string): Promise<EsignDocument | null>;
    /** 최신순(created_at DESC, id DESC) 커서 페이지. kind·제목 검색은 서버에서 적용한다. */
    documents(actor: EsignActor, query?: EsignListQuery & { kind?: EsignDocument["kind"] }): Promise<EsignListPage<EsignDocument>>;
    create(aggregate: EsignAggregate): Promise<void>;
    /** 최신순 커서 페이지의 계약·서명자 요약(문서 스냅샷·작업·기록 제외). 제목·서명자 이름 검색. 상세는 read(). */
    list(actor: EsignActor, query?: EsignListQuery): Promise<EsignListPage<EsignListAggregate>>;
    read(id: string): Promise<EsignAggregate | null>;
    recipientByTokenHash(hash: string): Promise<{ envelopeId: string; recipientId: string } | null>;
    dueExpirations(now: string, limit: number): Promise<string[]>;
    mutate<T>(id: string, action: (aggregate: EsignAggregate) => T): Promise<T>;
    claimJob(now: string, leaseUntil: string, leaseId: string): Promise<EsignJob | null>;
    close?(): Promise<void>;
}
