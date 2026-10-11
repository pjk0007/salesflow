/**
 * 답장 받는 곳 규칙 — 순수 함수만 (docs/2026-10-02-sender-warmup/DESIGN-3-reply-to.md).
 *
 * DB·네트워크를 모른다. 시험이 이 파일만 import하면 DB 커넥션이 열리지 않는다 (화면 코드에서 불러도 된다).
 * 2026-10-04 실제 발송에서 NHN이 사용자 지정 헤더 Reply-To를 거절했다 (DESIGN-3 6절 "실제 발송 결과(2026-10-04)와 바뀐 결정") —
 * 발송 요청에는 Reply-To를 넣지 않는다 (NHN이 막는 헤더 이름은 nhn-email-headers.ts가 보낼 때 한 번 더 거른다).
 * 고객 답장은 메일을 보낸 주소(From)로 간다. 그래서 여기 남은 것은:
 * - 워크스페이스 설정 API의 replyToEmail 입력 검사 (칸은 DB·API에 남아 있지만 발송에 쓰지 않는다)
 * - MX 조회 결과 해석·도메인 규칙 (조회 자체는 email-mx-lookup.ts) — 발신 도메인이 답장을 받을 수 있는지 화면에 알린다
 * - 규칙의 발신 묶음이 실제로 쓸 주소 고르기 (GET /api/email/reply-to)
 */

export const REPLY_TO_MAX_LENGTH = 200;

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
 * 답장 받을 주소로 저장할 수 있는 이메일인가. 좁게 받는다 —
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
 * null·빈 문자열·공백만 → value null (답장 주소 없음). 저장한 값은 발송에 쓰지 않는다 (위 머리말).
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

/**
 * MX 결과 캐시 기간.
 * - ok: 하루 — 받는 도메인이 갑자기 안 받게 되는 일은 드물다
 * - none: 10분 — 화면 안내("도메인에 메일 수신(MX)을 연결해야 답장이 옵니다")대로 MX를 연결하면 그 뒤 10분 안에 안내가 걷혀야 한다.
 *   하루로 두면 MX를 연결한 뒤에도 최대 하루(또는 서버를 다시 띄울 때까지) "받을 수 없음"이 남는다 (REVIEW-4 F1)
 * - unknown(일시 오류일 수 있다): 10분 — 하루 내내 "확인 못 함"으로 남지 않게
 */
export const MX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const MX_NONE_TTL_MS = 10 * 60 * 1000;
export const MX_UNKNOWN_TTL_MS = 10 * 60 * 1000;

export function mxCacheTtlMs(status: MxStatus): number {
    if (status === "ok") return MX_CACHE_TTL_MS;
    return status === "none" ? MX_NONE_TTL_MS : MX_UNKNOWN_TTL_MS;
}

// ============================================
// 발신 묶음의 도메인 (규칙 수정 화면)
// ============================================

function isPositiveId(v: unknown): v is number {
    return typeof v === "number" && Number.isSafeInteger(v) && v > 0;
}

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
