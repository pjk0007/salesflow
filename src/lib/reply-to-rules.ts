/**
 * 사업(워크스페이스)별 답장 받을 주소(Reply-To) 규칙 — 순수 함수만 (docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md).
 *
 * DB·네트워크를 모른다. 시험이 이 파일만 import하면 DB 커넥션이 열리지 않는다 (화면 코드에서 불러도 된다).
 * - 저장할 값 검사 (형식·200자) — 워크스페이스 설정 API
 * - NHN 발송 요청의 customHeaders 만들기 — 수신거부 헤더(List-Unsubscribe)와 합치고, 답장 주소가 없으면 Reply-To를 넣지 않는다
 * - 레코드의 워크스페이스로 답장 주소를 찾는 회차 캐시 (조회 함수는 부르는 쪽이 넘긴다 — email-reply-to.ts)
 * - MX 조회 결과 해석·도메인 규칙 (조회 자체는 email-mx-lookup.ts)
 */

export const REPLY_TO_MAX_LENGTH = 200;
export const REPLY_TO_HEADER = "Reply-To";

/** 도메인의 메일 받는 서버(MX) 조회 결과. unknown = DNS 일시 오류·시간 초과 등으로 확인하지 못함 */
export type MxStatus = "ok" | "none" | "unknown";

// ============================================
// 이메일 형식
// ============================================

/** 로컬 부분에 쓸 수 있는 글자 (RFC 5322 dot-atom, 따옴표 형식은 받지 않는다) */
const LOCAL_PART_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DOMAIN_LABEL_RE = /^[A-Za-z0-9-]{1,63}$/;
const TLD_RE = /^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

function isValidDomainName(domain: string): boolean {
    if (domain.length === 0 || domain.length > 253) return false;
    const labels = domain.split(".");
    if (labels.length < 2) return false;
    for (const label of labels) {
        if (!DOMAIN_LABEL_RE.test(label)) return false;
        if (label.startsWith("-") || label.endsWith("-")) return false;
    }
    return TLD_RE.test(labels[labels.length - 1]);
}

/**
 * 답장 받을 주소로 쓸 수 있는 이메일인가. 헤더에 그대로 들어가므로 좁게 받는다 —
 * 공백·줄바꿈(헤더 주입)·쉼표·꺾쇠·따옴표·한글 도메인(퓨니코드로 적어야 함)은 받지 않는다.
 */
export function isValidReplyToEmail(value: string): boolean {
    if (value.length === 0 || value.length > REPLY_TO_MAX_LENGTH) return false;
    const at = value.indexOf("@");
    if (at <= 0 || at !== value.lastIndexOf("@")) return false;
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (local.length > 64 || !LOCAL_PART_RE.test(local)) return false;
    if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
    return isValidDomainName(domain);
}

export type ReplyToInputResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * 워크스페이스 설정 API의 replyToEmail 입력 검사 (R4). 앞뒤 공백을 지우고 도메인은 소문자로 저장한다.
 * null·빈 문자열·공백만 → value null (답장 주소 없음 = Reply-To 헤더 없음, 지금과 같다).
 * 칸을 보내지 않은 경우(undefined)는 부르는 쪽이 "바꾸지 않음"으로 다룬다 — 여기 넘기지 않는다.
 */
export function normalizeReplyToInput(raw: unknown): ReplyToInputResult {
    if (raw === null) return { ok: true, value: null };
    if (typeof raw !== "string") {
        return { ok: false, error: "답장 받을 주소는 문자열이어야 합니다." };
    }
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: true, value: null };
    if (trimmed.length > REPLY_TO_MAX_LENGTH) {
        return { ok: false, error: `답장 받을 주소는 ${REPLY_TO_MAX_LENGTH}자 이하로 입력해주세요.` };
    }
    if (!isValidReplyToEmail(trimmed)) {
        return { ok: false, error: "답장 받을 주소의 이메일 형식이 올바르지 않습니다. 예: ceo@matchesplan.com" };
    }
    const at = trimmed.indexOf("@");
    return { ok: true, value: `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}` };
}

// ============================================
// 발송 헤더
// ============================================

/**
 * DB에 저장된 답장 주소를 헤더 값으로. 비었거나 형식이 아니면 null (헤더를 넣지 않는다).
 * 저장할 때 이미 검사하지만 헤더에 들어가는 값이라 보낼 때 한 번 더 거른다 — 손으로 넣은 값에 줄바꿈이 있어도 헤더가 깨지지 않게.
 */
export function replyToHeaderValue(stored: string | null | undefined): string | null {
    if (typeof stored !== "string") return null;
    const v = stored.trim();
    return v !== "" && isValidReplyToEmail(v) ? v : null;
}

/**
 * NHN eachMail 요청에 펼쳐 넣을 customHeaders (R1·R2·R6).
 * - listUnsubscribe: buildListUnsubscribeHeaders의 결과 (수신거부 링크를 쓰지 않는 메일이면 null)
 * - replyTo: 워크스페이스 답장 주소 (없으면 null — Reply-To를 넣지 않는다)
 * 둘 다 없으면 빈 객체 — customHeaders 칸 자체를 보내지 않는다 (지금과 같은 요청).
 * 사용: `...buildCustomHeaders({ listUnsubscribe, replyTo })`
 */
export function buildCustomHeaders(parts: {
    listUnsubscribe?: Record<string, string> | null;
    replyTo?: string | null;
}): { customHeaders?: Record<string, string> } {
    const headers: Record<string, string> = { ...(parts.listUnsubscribe ?? {}) };
    const replyTo = replyToHeaderValue(parts.replyTo);
    if (replyTo) {
        // 같은 이름의 헤더가 두 번 나가지 않게 — 대소문자가 다른 Reply-To가 있으면 지운다
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === REPLY_TO_HEADER.toLowerCase()) delete headers[key];
        }
        headers[REPLY_TO_HEADER] = replyTo;
    }
    return Object.keys(headers).length > 0 ? { customHeaders: headers } : {};
}

// ============================================
// 레코드의 워크스페이스 → 답장 주소 (회차 캐시)
// ============================================

export interface ReplyToLoaders {
    /** 워크스페이스의 저장된 답장 주소 (없으면 null). 워크스페이스가 없어도 null */
    loadWorkspaceReplyTo: (workspaceId: number) => Promise<string | null>;
    /** 파티션의 워크스페이스 id (없으면 null) */
    loadPartitionWorkspaceId: (partitionId: number) => Promise<number | null>;
}

export interface ReplyToResolver {
    /** 워크스페이스의 답장 주소 헤더 값 (없거나 형식이 아니면 null) */
    forWorkspace(workspaceId: number | null | undefined): Promise<string | null>;
    /** 레코드가 없을 때(지운 레코드의 후속 등) 파티션의 워크스페이스로 찾는다 */
    forPartition(partitionId: number | null | undefined): Promise<string | null>;
    /** 이미 읽은 워크스페이스 줄의 값을 넣어 둔다 — 다시 조회하지 않는다 */
    prime(workspaceId: number, stored: string | null | undefined): void;
}

function isPositiveId(v: unknown): v is number {
    return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

/**
 * 답장 주소 회차 캐시. 대기열·후속·반복 워커는 회차마다 하나를 만들어 줄마다 넘긴다 — 같은 워크스페이스를
 * 줄마다 다시 읽지 않는다 (한 회차는 길어야 8분이라 그사이 바꾼 값은 다음 회차부터 쓴다).
 * 워크스페이스마다 따로 담는다 — 다른 워크스페이스의 값이 섞이지 않는다 (R3).
 * 조회가 던지면 캐시에 남기지 않고 그대로 던진다 — 답장 주소를 모른 채 보내면 답장이 되돌아가므로 그 메일은 실패로 다룬다
 * (발송 경로는 sendEachMail 전에 던지면 잡은 발신 자리를 돌려준다).
 */
export function createReplyToResolver(loaders: ReplyToLoaders): ReplyToResolver {
    const byWorkspace = new Map<number, Promise<string | null>>();
    const byPartition = new Map<number, Promise<number | null>>();

    const forWorkspace = (workspaceId: number | null | undefined): Promise<string | null> => {
        if (!isPositiveId(workspaceId)) return Promise.resolve(null);
        const cached = byWorkspace.get(workspaceId);
        if (cached) return cached;
        const p = loaders.loadWorkspaceReplyTo(workspaceId).then(replyToHeaderValue);
        byWorkspace.set(workspaceId, p);
        p.catch(() => {
            if (byWorkspace.get(workspaceId) === p) byWorkspace.delete(workspaceId);
        });
        return p;
    };

    const forPartition = async (partitionId: number | null | undefined): Promise<string | null> => {
        if (!isPositiveId(partitionId)) return null;
        let wsp = byPartition.get(partitionId);
        if (!wsp) {
            const p = loaders.loadPartitionWorkspaceId(partitionId);
            byPartition.set(partitionId, p);
            p.catch(() => {
                if (byPartition.get(partitionId) === p) byPartition.delete(partitionId);
            });
            wsp = p;
        }
        return forWorkspace(await wsp);
    };

    return {
        forWorkspace,
        forPartition,
        prime(workspaceId, stored) {
            if (!isPositiveId(workspaceId)) return;
            byWorkspace.set(workspaceId, Promise.resolve(replyToHeaderValue(stored)));
        },
    };
}

// ============================================
// 도메인·MX
// ============================================

/** 이메일 주소의 도메인 (소문자, 마지막 @ 뒤). 형식이 아니면 null */
export function emailDomain(email: string | null | undefined): string | null {
    if (typeof email !== "string") return null;
    const v = email.trim();
    const at = v.lastIndexOf("@");
    if (at <= 0 || at === v.length - 1) return null;
    return v.slice(at + 1).toLowerCase();
}

/** 메일을 받을 수 없는 예약 도메인 (RFC 2606·6761). 조회하지 않고 MX 없음으로 본다 — 시험 환경이 바깥 DNS로 나가지 않는다 */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

export function isReservedMailDomain(domain: string): boolean {
    const d = domain.trim().toLowerCase().replace(/\.$/, "");
    if (RESERVED_DOMAINS.has(d)) return true;
    for (const r of RESERVED_DOMAINS) if (d.endsWith(`.${r}`)) return true;
    const tld = d.slice(d.lastIndexOf(".") + 1);
    return RESERVED_TLDS.has(tld);
}

/** MX 조회가 돌려준 레코드 해석. 받는 서버가 하나라도 있으면 ok. 비었거나 "null MX"(RFC 7505, exchange "" 또는 ".")뿐이면 none */
export function classifyMxRecords(records: ReadonlyArray<{ exchange: string; priority?: number }> | null | undefined): MxStatus {
    const hosts = (records ?? []).map((r) => String(r?.exchange ?? "").trim().replace(/\.$/, ""));
    return hosts.some((h) => h !== "") ? "ok" : "none";
}

/** MX가 없다고 확정하는 DNS 오류 (그 이름이 없거나 MX 레코드가 없음). 그 밖(시간 초과·서버 실패·연결 거부)은 확인 못 함 */
const MX_NONE_ERROR_CODES = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);

export function classifyMxError(code: string | null | undefined): MxStatus {
    return code && MX_NONE_ERROR_CODES.has(code) ? "none" : "unknown";
}

/** MX 결과 캐시 기간. ok·none은 하루, unknown(일시 오류일 수 있다)은 10분만 — 하루 내내 "확인 못 함"으로 남지 않게 */
export const MX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MX_UNKNOWN_TTL_MS = 10 * 60 * 1000;

export function mxCacheTtlMs(status: MxStatus): number {
    return status === "unknown" ? MX_UNKNOWN_TTL_MS : MX_CACHE_TTL_MS;
}

// ============================================
// 발신 묶음의 도메인 (규칙 수정 화면)
// ============================================

/** 조직의 발신 주소 하나와 그 도메인의 MX (GET /api/email/reply-to) */
export interface SenderMxEntry {
    /** 발신 프로필 id. 설정(email_configs)의 레거시 발신자면 null */
    profileId: number | null;
    fromEmail: string;
    domain: string | null;
    mx: MxStatus | null;
    isDefault: boolean;
}

/**
 * 규칙의 발신 묶음이 실제로 쓸 주소들 — 발송(claimSender pool)과 같은 순서: 묶음 id 중 이 조직에 있는 주소(묶음 순서, 중복 없이),
 * 하나도 없으면 기본 주소(id가 가장 작은 기본), 그것도 없으면 설정 발신자(profileId null).
 */
export function poolSenderEntries(
    poolIds: ReadonlyArray<number | null | undefined>,
    senders: readonly SenderMxEntry[],
): SenderMxEntry[] {
    const profiles = senders.filter((s) => s.profileId !== null);
    const byId = new Map(profiles.map((s) => [s.profileId as number, s]));
    const out: SenderMxEntry[] = [];
    const seen = new Set<number>();
    for (const id of poolIds) {
        if (!isPositiveId(id) || seen.has(id)) continue;
        const s = byId.get(id);
        if (!s) continue;
        seen.add(id);
        out.push(s);
    }
    if (out.length > 0) return out;
    const defaults = profiles
        .filter((s) => s.isDefault)
        .sort((a, b) => (a.profileId as number) - (b.profileId as number));
    if (defaults.length > 0) return [defaults[0]];
    const legacy = senders.find((s) => s.profileId === null);
    return legacy ? [legacy] : [];
}
