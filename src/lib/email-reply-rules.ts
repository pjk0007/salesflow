/**
 * 회신 받기 — 순수 규칙. DB·네트워크를 모른다 (@/lib/db import 금지).
 *
 * 워커(email-reply-sync.ts)·효과(email-reply-effects.ts)·라우트·시험이 같은 규칙을 쓴다.
 * 설계: docs/2026-10-11-reply-and-health/DESIGN-RPL.md 3~8절.
 *
 * 개인정보 (대표 조건): 회신 메일함에는 채용 제안·급여 같은 남의 메일이 있다. 여기 규칙은
 *   1단계(받는 사람·스레드 머리글)만으로 "샌드비 발신 주소 앞으로 온 메일"인지 가르고 (recipientOwnership),
 *   메일함 주소·메일함 쪽 도메인 위의 주소는 우리 주소 모음에서 늘 뺀다 (buildOurAddressSet, B1).
 * 남의 메일은 보낸 사람·제목·본문을 읽지 않는다 — 이 파일의 함수는 그런 값을 받지 않는다.
 */

import {
    EMAIL_TRIM_CHARS,
    contactSummaryOf,
    deadlineText,
    normalizeEmail,
    type AlertEvidence,
} from "@/lib/deep-visitor-alert-rules";
import { formatKstShort, kstParts } from "@/lib/kst";
import { classifyDsn } from "@/lib/email-status-sync-rules";
import { chatSafe } from "@/lib/chat-text";
import { chatWebhookProblem } from "@/lib/google-chat";

export { EMAIL_TRIM_CHARS };

// ============================================
// 상수 (3절 "코드 상수")
// ============================================

/** 운영 서버 origin. NEXT_PUBLIC_BASE_URL의 origin이 이것이 아니면 시험 서버다 (M1) */
export const REPLY_PRODUCTION_ORIGIN = "https://sendb.kr";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 보내기 직전 막기 기간 (사람 회신·hard 반송). 수신거부 말이 있는 회신은 기한 없음 */
export const BLOCK_DAYS = 90;
/** 대체 짝짓기 기간 (6-2). 반송은 SND 7일 */
export const MATCH_WINDOW_DAYS = 60;
/** 저장 발췌·카드 발췌 길이 */
export const EXCERPT_MAX_CHARS = 500;
export const CARD_EXCERPT_MAX_CHARS = 300;
/** 이보다 오래된 회신은 카드를 보내지 않는다 (처음 거슬러 읽기·밀린 효과) */
export const ALERT_MAX_AGE_MS = 24 * HOUR_MS;
/** on으로 바꿨을 때 거슬러 효과를 적용하는 기간 */
export const PENDING_EFFECTS_DAYS = 14;
export const PENDING_EFFECTS_BATCH = 50;
/** 회차 예산 (5분 주기보다 짧게) */
export const RUN_BUDGET_MS = 4 * MINUTE_MS;
/** 회차 끝 알림 보내기 예산 */
export const ALERT_DELIVERY_BUDGET_MS = 60 * 1000;
/**
 * 메일 읽기 예산 — 회차 예산에서 알림 보내기 몫(60초)을 늘 남긴다 (RC-14). 읽기가 4분을 다 쓰면 그 회차 카드가 0통이었다
 */
export const READ_BUDGET_MS = RUN_BUDGET_MS - ALERT_DELIVERY_BUDGET_MS;
/** 회차마다 1단계(머리글) 최대 메일 수 */
export const STAGE1_MAX_PER_RUN = 500;
/** 회차마다 2단계(본문) 최대 메일 수 */
export const BODY_MAX_PER_RUN = 50;
/** 묶음 크기 — 묶음이 끝날 때마다 커서를 옮긴다 */
export const PROCESS_BATCH_SIZE = 50;
/** 반송·시스템 안내의 보고 부분을 첨부로 받을 때 최대 크기 (M9) */
export const REPORT_PART_MAX_BYTES = 64 * 1024;
/** 이보다 큰 메일은 format=full 대신 머리글만 받는다 */
export const FULL_FORMAT_MAX_BYTES = 5 * 1024 * 1024;
/**
 * 본문·보고 부분·머리글 값을 글 처리(정규식)에 넣기 전에 자르는 길이 (글자 수).
 * 발췌는 500자면 되고, 공개 주소 cs@로 누구나 큰 본문을 보낼 수 있다 — 길이 제한 없이 넣으면 한 통으로 서버가 멈출 수 있다 (RH-SEC-1)
 */
export const BODY_SCAN_MAX_CHARS = 64 * 1024;
/** 주소 목록 머리글(To·Cc …) 값을 해석하기 전에 자르는 길이 — 1단계는 남의 메일 머리글도 읽는다 */
export const HEADER_SCAN_MAX_CHARS = 32 * 1024;
/** Gmail 동시 요청 수 */
export const GMAIL_CONCURRENCY = 4;
/** 운영 알림 간격 */
export const OPS_ALERT_INTERVAL_MS = 6 * HOUR_MS;
/** on인데 마지막 성공이 이보다 오래면 정체 (M7) */
export const STALE_SYNC_MS = 6 * HOUR_MS;
/** 일시 오류(429·5xx·DB 연결)가 이만큼 이어지면 운영 알림 */
export const TRANSIENT_ALERT_AFTER_MS = HOUR_MS;
/** processing에 이만큼 머문 알림 줄은 되돌린다 */
export const ALERT_STUCK_MS = 15 * MINUTE_MS;
/** 카드 글자 최대 길이 */
export const REPLY_MESSAGE_MAX_CHARS = 3800;
/** 주소 모음에 넣는 최근 발송의 기간 (4-1 ③, m2) */
export const SENDER_LOG_LOOKBACK_DAYS = 90;
/** parent_log_id 사슬을 거슬러 갈 최대 횟수 (6-4) */
export const CHAIN_MAX_DEPTH = 10;
/** 거슬러 읽기 기본·최대 (운영 / 시험 서버) */
export const DEFAULT_BACKFILL_DAYS_PRODUCTION = 14;
export const MAX_BACKFILL_DAYS = 60;
export const MAX_BACKFILL_DAYS_TEST_SERVER = 1;
/** history 404일 때 목록으로 이어 읽는 시작 범위 */
const HISTORY_FALLBACK_MIN_MS = 2 * DAY_MS;
const HISTORY_FALLBACK_MAX_MS = 30 * DAY_MS;

/** 카드 글자 끝 줄 — 읽는 사람이 할 일 (RC-11) */
export const REPLY_MESSAGE_FOOTER = "_자동 답장은 나가지 않습니다. 원문을 보고 직접 답장해 주세요._";
/** 회복 뒤 이만큼 안에 같은 문제가 다시 나면 바로 알리지 않는다 — 오락가락할 때 경고·회복이 계속 나가지 않게 (RO-15) */
export const OPS_FLAP_WINDOW_MS = 60 * 60 * 1000;
export const OLD_REPLY_ALERT_ERROR = "오래된 회신 (24시간 지남) — 알림 안 함";

// ============================================
// 설정 (3절)
// ============================================

export type ReplySyncMode = "off" | "dry_run" | "on";
export type ReplyAlertMode = "off" | "dry_run" | "live";
export type ReplyServerKind = "production" | "test";

export type ReplyConfigWarningCode =
    | "test_server_allowed_from"
    | "test_server_no_allowed_from"
    | "test_server_on_blocked"
    | "test_server_live_blocked"
    | "backfill_capped"
    | "private_domains_missing"
    | "alert_webhook_missing"
    | "alert_webhook_invalid"
    | "ops_webhook_invalid";

export interface ReplyConfigWarning {
    code: ReplyConfigWarningCode;
    /** 회신 탭 띠에 보일 한국어 한 줄 */
    text: string;
}

export interface ReplyCredentials {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
}

export interface ReplyConfig {
    /** 실제로 도는 모드 (시험 서버 제한 반영) */
    syncMode: ReplySyncMode;
    alertMode: ReplyAlertMode;
    /** env에 적힌 모드 (모르는 값은 dry_run) */
    requestedSyncMode: ReplySyncMode;
    requestedAlertMode: ReplyAlertMode;
    /** 읽을 메일함 (소문자) */
    mailbox: string;
    /** 비밀값 셋. 하나라도 없으면 null → Google을 부르지 않는다 */
    credentials: ReplyCredentials | null;
    /** 메일함 쪽 도메인 (메일함 도메인 + REPLY_PRIVATE_DOMAINS, 소문자) */
    privateDomains: string[];
    /** 메일함 쪽 도메인 위에 있지만 샌드비 발신 주소인 것 (정규화) */
    sharedDomainAddresses: string[];
    /** 회신을 처리할 워크스페이스 (비면 아무것도 처리하지 않는다) */
    workspaceIds: number[];
    /** 있으면 이 주소만 우리 발신 주소 (정규화) */
    senderEmails: string[] | null;
    /** 있으면 보낸 사람이 이 주소인 메일만 2단계 (정규화) */
    allowedFrom: string[] | null;
    /** 처음 한 번 거슬러 읽을 날 수 */
    backfillDays: number;
    serverKind: ReplyServerKind;
    /** 카드 링크 앞부분 (끝 / 없음) */
    baseUrl: string;
    /** 운영 알림 받는 곳 (M7). 이름만 로그에 남긴다 — 주소는 비밀값 */
    opsWebhook: { url: string; source: "REPLY_OPS_WEBHOOK_URL" | "SEND_HEALTH_WEBHOOK_URL" | "DEEP_ALERT_WEBHOOK_URL" } | null;
    /** 워크스페이스별 사업 스페이스 웹훅 (DEEP_ALERT_WEBHOOK_URL_<id> → DEEP_ALERT_WEBHOOK_URL, 구글 챗 주소만) */
    webhookByWorkspace: Record<number, string>;
    /** 워크스페이스마다 웹훅을 정하는 환경 변수 이름과 값 — 없음·형식 오류를 운영 스페이스에 알릴 때 쓴다 (값은 남기지 않는다, RC-4) */
    webhookChecks: Array<{ workspaceId: number; source: string; url: string | null }>;
    warnings: ReplyConfigWarning[];
    /**
     * 메일함을 읽지 않는 까닭 (있으면 회차가 Gmail을 부르지 않는다). 모드는 그대로 둔다 — 이미 저장된 회신의 보내기 직전 막기는
     * 계속 돈다. private_domains_missing = 운영 서버인데 REPLY_PRIVATE_DOMAINS가 비었다 (RH-SEC-2, 실패하면 닫힌다)
     */
    readBlockedReason: "private_domains_missing" | null;
}

type Env = Record<string, string | undefined>;

function parseMode<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
    const v = (raw ?? "").trim().toLowerCase();
    return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function parseIdList(raw: string | undefined): number[] {
    const out: number[] = [];
    for (const part of (raw ?? "").split(",")) {
        const s = part.trim();
        if (!/^\d+$/.test(s)) continue;
        const n = Number(s);
        if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

function parseAddressCsv(raw: string | undefined): string[] {
    const out: string[] = [];
    for (const part of (raw ?? "").split(",")) {
        const a = normalizeReplyAddress(part);
        if (isAddress(a) && !out.includes(a)) out.push(a);
    }
    return out;
}

function parseDomainCsv(raw: string | undefined): string[] {
    const out: string[] = [];
    for (const part of (raw ?? "").split(",")) {
        const d = normalizeEmail(part).replace(/^@/, "");
        if (d && /^[a-z0-9.-]+\.[a-z0-9-]+$/i.test(d) && !out.includes(d)) out.push(d);
    }
    return out;
}

/** NEXT_PUBLIC_BASE_URL의 origin. 잘못된 값이면 null */
function originOf(url: string | undefined): string | null {
    try {
        return new URL((url ?? "").trim()).origin;
    } catch {
        return null;
    }
}

/** DATABASE_URL 호스트가 이 PC인가 (REPLY_TEST_ASSUME_PRODUCTION을 받는 조건, 15-3) */
function isLocalDatabase(url: string | undefined): boolean {
    try {
        const host = new URL((url ?? "").trim()).hostname;
        return host === "127.0.0.1" || host === "localhost";
    } catch {
        return false;
    }
}

/**
 * 3절 설정. 운영 서버 판정과 시험 서버 제한(M1)을 여기서 적용한다 — 제한에 걸린 on·live는 dry_run으로 바뀌고 warnings에 남는다.
 * env는 process.env 꼴.
 */
export function resolveReplyConfig(env: Env): ReplyConfig {
    const requestedSyncMode = parseMode<ReplySyncMode>(env.REPLY_SYNC_MODE, ["off", "dry_run", "on"], "dry_run");
    const requestedAlertMode = parseMode<ReplyAlertMode>(env.REPLY_ALERT_MODE, ["off", "dry_run", "live"], "dry_run");

    const mailbox = normalizeEmail(env.REPLY_MAILBOX) || "ceo@matchesplan.com";
    const clientId = (env.REPLY_GOOGLE_CLIENT_ID ?? "").trim();
    const clientSecret = (env.REPLY_GOOGLE_CLIENT_SECRET ?? "").trim();
    const refreshToken = (env.REPLY_GOOGLE_REFRESH_TOKEN ?? "").trim();
    const credentials = clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;

    // "none"은 메일함 주인 계정에 별칭 도메인이 정말 없다는 뜻 (빈 값과 다르다 — 빈 값은 운영 서버에서 읽기를 막는다)
    const rawPrivateDomains = (env.REPLY_PRIVATE_DOMAINS ?? "").trim();
    const privateDomainsNone = rawPrivateDomains.toLowerCase() === "none";
    const privateDomains = privateDomainsNone ? [] : parseDomainCsv(rawPrivateDomains);
    const privateDomainsGiven = privateDomainsNone || privateDomains.length > 0;
    const mailboxDomain = domainOfAddress(mailbox);
    if (mailboxDomain && !privateDomains.includes(mailboxDomain)) privateDomains.unshift(mailboxDomain);

    const sharedDomainAddresses = parseAddressCsv(env.REPLY_SHARED_DOMAIN_ADDRESSES);
    let workspaceIds = parseIdList(env.REPLY_WORKSPACE_IDS);
    if (workspaceIds.length === 0) workspaceIds = parseIdList(env.DEEP_ALERT_WORKSPACE_IDS);

    const senderList = parseAddressCsv(env.REPLY_SENDER_EMAILS);
    const allowedList = parseAddressCsv(env.REPLY_ALLOWED_FROM);
    const senderEmails = senderList.length > 0 ? senderList : null;
    const allowedFrom = allowedList.length > 0 ? allowedList : null;

    const baseUrl = ((env.NEXT_PUBLIC_BASE_URL ?? "").trim() || REPLY_PRODUCTION_ORIGIN).replace(/\/+$/, "");
    const assumeProduction = (env.REPLY_TEST_ASSUME_PRODUCTION ?? "").trim() === "1" && isLocalDatabase(env.DATABASE_URL);
    const serverKind: ReplyServerKind =
        originOf(env.NEXT_PUBLIC_BASE_URL) === REPLY_PRODUCTION_ORIGIN || assumeProduction ? "production" : "test";

    const warnings: ReplyConfigWarning[] = [];
    let syncMode = requestedSyncMode;
    let alertMode = requestedAlertMode;
    let backfillDays: number;
    const rawBackfill = (env.REPLY_BACKFILL_DAYS ?? "").trim();
    const parsedBackfill = /^\d+$/.test(rawBackfill) ? Number(rawBackfill) : null;

    if (serverKind === "test") {
        warnings.push(
            allowedFrom
                ? { code: "test_server_allowed_from", text: "시험 서버 — 직원 주소(REPLY_ALLOWED_FROM)가 보낸 메일만 읽습니다" }
                : {
                      code: "test_server_no_allowed_from",
                      text: "시험 서버 — 직원 주소(REPLY_ALLOWED_FROM)가 없어 회신을 저장하지 않습니다 (판정 숫자만 셉니다)",
                  }
        );
        const testLimitsMet = senderEmails !== null && allowedFrom !== null;
        if (syncMode === "on" && !testLimitsMet) {
            syncMode = "dry_run";
            warnings.push({ code: "test_server_on_blocked", text: "시험 서버 — 시험 주소·직원 주소 없이 on을 켤 수 없습니다 (dry_run으로 돕니다)" });
        }
        if (alertMode === "live" && !testLimitsMet) {
            alertMode = "dry_run";
            warnings.push({ code: "test_server_live_blocked", text: "시험 서버 — 시험 주소·직원 주소 없이 카드를 보낼 수 없습니다 (dry_run으로 돕니다)" });
        }
        backfillDays = Math.min(parsedBackfill ?? 0, MAX_BACKFILL_DAYS_TEST_SERVER);
        if (parsedBackfill !== null && parsedBackfill > MAX_BACKFILL_DAYS_TEST_SERVER) {
            warnings.push({ code: "backfill_capped", text: `시험 서버 — 거슬러 읽기는 최대 ${MAX_BACKFILL_DAYS_TEST_SERVER}일입니다` });
        }
    } else {
        backfillDays = Math.min(parsedBackfill ?? DEFAULT_BACKFILL_DAYS_PRODUCTION, MAX_BACKFILL_DAYS);
    }

    // 운영 서버에서 메일함 쪽 도메인을 적지 않았으면 읽지 않는다 (RH-SEC-2). 별칭 도메인 위 공용 주소(hr@ 등)가 발신 프로필로
    // 들어오면 채용·급여 메일이 "주소 일치"로 본문까지 읽힌다 — 설정이 빠졌을 때 조용히 읽지 않고 닫힌다
    let readBlockedReason: ReplyConfig["readBlockedReason"] = null;
    if (serverKind === "production" && !privateDomainsGiven) {
        readBlockedReason = "private_domains_missing";
        warnings.push({
            code: "private_domains_missing",
            text: "운영 서버 — REPLY_PRIVATE_DOMAINS가 비어 있어 회신 메일함을 읽지 않습니다. 메일함 주인 계정의 별칭 도메인을 쉼표로 적어 주세요 (정말 없으면 none)",
        });
    }

    const opsCandidates = [
        ["REPLY_OPS_WEBHOOK_URL", env.REPLY_OPS_WEBHOOK_URL],
        ["SEND_HEALTH_WEBHOOK_URL", env.SEND_HEALTH_WEBHOOK_URL],
        ["DEEP_ALERT_WEBHOOK_URL", env.DEEP_ALERT_WEBHOOK_URL],
    ] as const;
    let opsWebhook: ReplyConfig["opsWebhook"] = null;
    for (const [source, value] of opsCandidates) {
        const url = (value ?? "").trim();
        if (!url) continue;
        // 구글 챗 수신 웹훅 주소만. 값이 있는데 형식이 틀리면 다음 후보로 넘어가되 띠에 알린다 (RO-12)
        if (chatWebhookProblem(url)) {
            warnings.push({
                code: "ops_webhook_invalid",
                text: `운영 알림 웹훅 ${source}의 주소 형식이 틀려 쓰지 않습니다 (https://chat.googleapis.com/v1/spaces/…/messages 꼴이어야 함)`,
            });
            continue;
        }
        if (!opsWebhook) opsWebhook = { url, source };
    }

    // 깊이 알림(resolveAlertConfig)과 같은 규칙: 워크스페이스별 값이 있으면 그것만, 없으면 공통. 구글 챗 주소만 (CT-6)
    const common = (env.DEEP_ALERT_WEBHOOK_URL ?? "").trim();
    const webhookByWorkspace: Record<number, string> = {};
    const webhookChecks: ReplyConfig["webhookChecks"] = [];
    const missingIds: number[] = [];
    const invalidIds: number[] = [];
    for (const id of workspaceIds) {
        const own = (env[`DEEP_ALERT_WEBHOOK_URL_${id}`] ?? "").trim();
        const url = own || common;
        const source = own || !common ? `DEEP_ALERT_WEBHOOK_URL_${id}` : "DEEP_ALERT_WEBHOOK_URL";
        webhookChecks.push({ workspaceId: id, source, url: url || null });
        const problem = chatWebhookProblem(url);
        if (!problem) webhookByWorkspace[id] = url;
        else if (problem === "missing") missingIds.push(id);
        else invalidIds.push(id);
    }
    // 카드를 보내는데 웹훅이 없거나 틀린 사업은 띠에 알린다 — 카드는 닫지 않고 기다린다 (RC-4)
    if (alertMode === "live" && missingIds.length > 0) {
        warnings.push({
            code: "alert_webhook_missing",
            text: `회신 카드를 보낼 웹훅이 없는 워크스페이스: ${missingIds.join(", ")} (DEEP_ALERT_WEBHOOK_URL_<번호>) — 카드가 기다리다 24시간 뒤 버려집니다`,
        });
    }
    if (alertMode === "live" && invalidIds.length > 0) {
        warnings.push({
            code: "alert_webhook_invalid",
            text: `회신 카드 웹훅 주소 형식이 틀린 워크스페이스: ${invalidIds.join(", ")} (구글 챗 https://chat.googleapis.com/v1/spaces/…/messages 꼴이어야 함)`,
        });
    }

    return {
        syncMode,
        alertMode,
        requestedSyncMode,
        requestedAlertMode,
        mailbox,
        credentials,
        privateDomains,
        sharedDomainAddresses,
        workspaceIds,
        senderEmails,
        allowedFrom,
        backfillDays,
        serverKind,
        baseUrl,
        opsWebhook,
        webhookByWorkspace,
        webhookChecks,
        warnings,
        readBlockedReason,
    };
}

// ============================================
// 주소 (4-1)
// ============================================

function isAddress(a: string): boolean {
    const at = a.lastIndexOf("@");
    return at > 0 && at < a.length - 1 && !/\s/.test(a);
}

/**
 * 회신 비교용 주소: 앞뒤 EMAIL_TRIM_CHARS 제거 + 소문자 + 로컬 부분의 +태그 제거 (`cs+x@d` = `cs@d`. 구글은 + 주소를 같은 메일함으로 받는다).
 * 기존 normalizeSenderAddress(+태그를 떼지 않음)와 다른 함수다 (m9)
 */
export function normalizeReplyAddress(raw: string | null | undefined): string {
    let s = normalizeEmail(raw);
    if (s.startsWith("<") && s.endsWith(">")) s = s.slice(1, -1).trim();
    const at = s.lastIndexOf("@");
    if (at <= 0) return s;
    const local = s.slice(0, at);
    const plus = local.indexOf("+");
    return (plus > 0 ? local.slice(0, plus) : local) + s.slice(at);
}

/** 막기·멈춤 비교용 값 둘: 소문자(+태그 그대로)와 +태그를 뗀 값 */
export function addressVariants(raw: string | null | undefined): string[] {
    const lower = normalizeEmail(raw);
    const out: string[] = [];
    if (lower) out.push(lower);
    const norm = normalizeReplyAddress(raw);
    if (norm && !out.includes(norm)) out.push(norm);
    return out;
}

export function domainOfAddress(address: string | null | undefined): string {
    const s = normalizeEmail(address);
    const at = s.lastIndexOf("@");
    return at >= 0 ? s.slice(at + 1) : "";
}

export function localPartOf(address: string | null | undefined): string {
    const s = normalizeEmail(address);
    const at = s.lastIndexOf("@");
    return at > 0 ? s.slice(0, at) : s;
}

/** 로그·화면용으로 주소를 가린다: `a***@도메인` */
export function maskEmail(address: string | null | undefined): string {
    const s = normalizeEmail(address);
    const at = s.lastIndexOf("@");
    if (at < 0) return s ? "***" : "";
    const local = s.slice(0, at);
    return `${local ? Array.from(local)[0] : ""}***@${s.slice(at + 1)}`;
}

// ── RFC 2047 머리글 풀기 ──

/** charset 이름 → TextDecoder 이름. 한국 메일의 ks_c_5601-1987·cp949는 euc-kr로 읽는다. 모르는 값은 utf-8 */
export function decoderCharset(charset: string | null | undefined): string {
    const c = (charset ?? "").trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!c) return "utf-8";
    if (c === "ks_c_5601-1987" || c === "ks_c_5601" || c === "cp949" || c === "x-windows-949" || c === "windows-949" || c === "uhc") {
        return "euc-kr";
    }
    try {
        new TextDecoder(c);
        return c;
    } catch {
        return "utf-8";
    }
}

function decodeBytes(bytes: Uint8Array, charset: string | null | undefined): string {
    try {
        return new TextDecoder(decoderCharset(charset)).decode(bytes);
    } catch {
        return new TextDecoder("utf-8").decode(bytes);
    }
}

function base64ToBytes(b64: string): Uint8Array {
    return Uint8Array.from(Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

function qDecodeBytes(text: string): Uint8Array {
    const out: number[] = [];
    const s = text.replace(/_/g, " ");
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "=" && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
            out.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            const code = ch.charCodeAt(0);
            if (code < 128) out.push(code);
            else for (const b of new TextEncoder().encode(ch)) out.push(b);
        }
    }
    return Uint8Array.from(out);
}

/** 머리글의 RFC 2047 인코딩(`=?UTF-8?B?…?=`, `=?EUC-KR?Q?…?=`)을 푼다. 붙은 인코딩 단어 사이 공백은 지운다 */
export function decodeMimeWords(value: string | null | undefined): string {
    const s = value ?? "";
    if (!s.includes("=?")) return s;
    const re = /=\?([^?\s]+)\?([bqBQ])\?([^?\s]*)\?=/g;
    let out = "";
    let last = 0;
    let prevWasWord = false;
    for (let m = re.exec(s); m; m = re.exec(s)) {
        const between = s.slice(last, m.index);
        if (!(prevWasWord && /^\s*$/.test(between))) out += between;
        const charset = m[1].split("*")[0];
        let decoded: string;
        try {
            const bytes = m[2].toLowerCase() === "b" ? base64ToBytes(m[3]) : qDecodeBytes(m[3]);
            decoded = decodeBytes(bytes, charset);
        } catch {
            decoded = m[0];
        }
        out += decoded;
        last = m.index + m[0].length;
        prevWasWord = true;
    }
    return out + s.slice(last);
}

// ── 주소 목록 머리글 (To·Cc·From …) ──

export interface ParsedAddress {
    name: string;
    address: string;
}

/** 쉼표로 가르되 따옴표·<>·() 안의 쉼표는 무시한다 */
function splitAddressList(value: string): string[] {
    const parts: string[] = [];
    let cur = "";
    let quote = false;
    let angle = 0;
    let paren = 0;
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "\\" && quote) {
            cur += ch + (value[i + 1] ?? "");
            i++;
            continue;
        }
        if (ch === '"' && angle === 0 && paren === 0) quote = !quote;
        else if (!quote) {
            if (ch === "<") angle++;
            else if (ch === ">" && angle > 0) angle--;
            else if (ch === "(") paren++;
            else if (ch === ")" && paren > 0) paren--;
            else if ((ch === "," || ch === ";") && angle === 0 && paren === 0) {
                parts.push(cur);
                cur = "";
                continue;
            }
        }
        cur += ch;
    }
    parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * 공백·<>·" 로 가른 조각 중 처음 나오는 주소 모양(앞뒤에 글자가 있는 @). 정규식 되돌아가기 없이 한 번 훑는다 —
 * `[^\s]+@[^\s]+` 꼴 정규식은 @ 없는 긴 글에서 처리 시간이 길이의 제곱으로 는다 (RH-SEC-1)
 */
function firstAddressToken(text: string): string {
    for (const token of text.split(/[\s<>"]+/)) {
        const at = token.indexOf("@");
        if (at > 0 && at < token.length - 1) return token;
    }
    return "";
}

/** 주소 목록 머리글 값 → [{ name, address }]. 주소 모양이 아닌 조각은 버린다. 그룹 문법(`이름: a@b, c@d;`)도 읽는다 */
export function parseAddressList(value: string | null | undefined): ParsedAddress[] {
    const out: ParsedAddress[] = [];
    for (const raw of splitAddressList((value ?? "").slice(0, HEADER_SCAN_MAX_CHARS))) {
        // 그룹 이름 떼기: 따옴표·<> 앞의 "이름:"
        let part = raw;
        const groupMatch = /^([^"<>@:]*):\s*(.*)$/.exec(part);
        if (groupMatch && !groupMatch[1].includes("@")) part = groupMatch[2];
        part = part.replace(/;\s*$/, "").trim();
        if (!part) continue;

        let name = "";
        let address = "";
        // 괄호 주석은 안쪽에 ( 가 없는 것만 맞춘다 — "((((" 같은 글에서 시작마다 끝까지 훑지 않게
        const angle = /<([^<>]*)>\s*(?:\([^()]*\)\s*)*$/.exec(part);
        if (angle) {
            address = angle[1];
            name = part.slice(0, angle.index).trim();
        } else {
            const noComment = part.replace(/\([^()]*\)/g, " ").trim();
            address = firstAddressToken(noComment);
            name = (/\(([^()]*)\)/.exec(part)?.[1] ?? "").trim();
        }
        name = decodeMimeWords(name.replace(/^"([\s\S]*)"$/, "$1").replace(/\\(.)/g, "$1")).trim();
        const addr = normalizeEmail(address);
        if (isAddress(addr)) out.push({ name, address: addr });
    }
    return out;
}

// ── 우리 발신 주소 모음 (4-1, B1) ──

export interface AddressCandidate {
    email: string;
    orgId: string;
    /** profile = 발신 프로필, config = email_configs, send_log = 최근 90일 발송 기록 */
    source: "profile" | "config" | "send_log";
}

export interface OurAddressSet {
    /** 정규화 주소 → 그 주소를 쓰는 조직들 */
    addresses: Map<string, string[]>;
    /** 남은 주소들의 도메인 → 조직들. 메일함 쪽 도메인은 늘 빠진다 */
    domains: Map<string, string[]>;
    /** 메일함 주소 (REPLY_MAILBOX·getProfile 주소) */
    mailboxAddresses: Set<string>;
    /** 메일함 쪽 도메인 (메일함 도메인·getProfile 도메인·REPLY_PRIVATE_DOMAINS) */
    mailboxDomains: Set<string>;
    /** 뺀 주소 (가린 모양, 중복 없음, 정렬) — 회신 탭 띠에 보인다 */
    excludedMasked: string[];
}

function pushOrg(map: Map<string, string[]>, key: string, orgId: string): void {
    const list = map.get(key);
    if (!list) map.set(key, [orgId]);
    else if (!list.includes(orgId)) list.push(orgId);
}

/**
 * 4-1 주소 모음. 빼는 주소(늘):
 *   1. REPLY_MAILBOX와 getProfile 주소
 *   2. 메일함 쪽 도메인 위의 주소 — REPLY_SHARED_DOMAIN_ADDRESSES에 적은 주소만 남는다
 * 메일함의 모든 메일은 Delivered-To가 메일함 주소이고, 별칭 도메인 위의 공용 주소(hr@·info@)로는 채용·급여 메일이 온다 —
 * 그런 주소가 하나라도 우리 주소에 섞이면 남의 메일이 "주소 일치"로 본문까지 읽힌다.
 * senderEmails(REPLY_SENDER_EMAILS)가 있으면 후보 중 그 주소만 본다 (빼는 규칙은 그대로).
 */
export function buildOurAddressSet(input: {
    candidates: readonly AddressCandidate[];
    mailbox: string;
    profileEmail: string | null;
    privateDomains: readonly string[];
    sharedDomainAddresses: readonly string[];
    senderEmails: readonly string[] | null;
}): OurAddressSet {
    const mailboxAddresses = new Set<string>();
    for (const a of [input.mailbox, input.profileEmail]) {
        const n = normalizeReplyAddress(a);
        if (isAddress(n)) mailboxAddresses.add(n);
    }
    const mailboxDomains = new Set<string>();
    for (const a of mailboxAddresses) mailboxDomains.add(domainOfAddress(a));
    for (const d of input.privateDomains) {
        const n = normalizeEmail(d);
        if (n) mailboxDomains.add(n);
    }
    const shared = new Set(input.sharedDomainAddresses.map((a) => normalizeReplyAddress(a)));
    const only = input.senderEmails ? new Set(input.senderEmails.map((a) => normalizeReplyAddress(a))) : null;

    const addresses = new Map<string, string[]>();
    const domains = new Map<string, string[]>();
    const excluded = new Set<string>();

    for (const c of input.candidates) {
        const a = normalizeReplyAddress(c.email);
        if (!isAddress(a)) continue;
        if (only && !only.has(a)) continue;
        if (mailboxAddresses.has(a)) {
            excluded.add(maskEmail(a));
            continue;
        }
        const domain = domainOfAddress(a);
        if (mailboxDomains.has(domain) && !shared.has(a)) {
            excluded.add(maskEmail(a));
            continue;
        }
        pushOrg(addresses, a, c.orgId);
        if (!mailboxDomains.has(domain)) pushOrg(domains, domain, c.orgId);
    }

    return {
        addresses,
        domains,
        mailboxAddresses,
        mailboxDomains,
        excludedMasked: [...excluded].sort(),
    };
}

/**
 * 발신 프로필을 새로 만들거나 주소를 바꿀 때 관리자 확인이 필요한가 (RH-SEC-2). 필요하면 화면에 보일 이유, 아니면 null.
 *
 * 회신 읽기는 "우리 발신 주소" 앞으로 온 메일을 대표 메일함에서 본문까지 읽는다. 멤버가 이 조직이 쓴 적 없는 도메인의 주소
 * (예: 대표 계정 별칭 도메인의 hr@)로 프로필을 만들면, REPLY_PRIVATE_DOMAINS에 그 도메인이 빠졌을 때 채용·급여 메일이
 * "주소 일치"로 읽힌다. 그래서 처음 쓰는 도메인은 관리자만 들인다. 이미 쓰는 도메인의 다른 주소는 예전처럼 누구나.
 * knownEmails = 이 조직의 다른 발신 프로필·email_configs 주소 (current 제외)
 */
export function newSenderDomainNeedsAdmin(input: {
    nextFromEmail: string | undefined;
    currentFromEmail: string | null;
    knownEmails: readonly (string | null | undefined)[];
}): string | null {
    if (input.nextFromEmail === undefined) return null;
    const nextDomain = domainOfAddress(input.nextFromEmail);
    if (!nextDomain) return null;
    if (input.currentFromEmail && domainOfAddress(input.currentFromEmail) === nextDomain) return null;
    const known = new Set(input.knownEmails.map((e) => domainOfAddress(e)).filter((d) => d !== ""));
    if (known.has(nextDomain)) return null;
    return "이 조직이 처음 쓰는 발신 도메인입니다. 회신 메일함에서 읽는 주소가 늘어나므로 관리자만 추가할 수 있습니다.";
}

// ============================================
// 1단계 판정 (4-2)
// ============================================

export interface GmailHeader {
    name: string;
    value: string;
}

/** 머리글 값 전부 (이름은 대소문자 무시, 나온 순서) */
export function headerValues(headers: readonly GmailHeader[] | null | undefined, name: string): string[] {
    const want = name.toLowerCase();
    return (headers ?? []).filter((h) => h.name.toLowerCase() === want).map((h) => h.value ?? "");
}

export function headerValue(headers: readonly GmailHeader[] | null | undefined, name: string): string | null {
    const all = headerValues(headers, name);
    return all.length > 0 ? all[0] : null;
}

/** 1단계에서 읽는 머리글 7개 (R5). 이 밖의 머리글은 1단계에서 요청하지 않는다 */
export const STAGE1_HEADERS = ["To", "Cc", "Delivered-To", "X-Original-To", "X-Gm-Original-To", "In-Reply-To", "References"] as const;
/** 우리 것 판정에 쓰는 받는 사람 머리글 (이 순서로 본다) */
const RECIPIENT_HEADERS = ["To", "Cc", "Delivered-To", "X-Original-To", "X-Gm-Original-To"] as const;

export type Ownership =
    /** 받는 주소가 우리 발신 주소와 같다 */
    | { kind: "address"; address: string; orgIds: string[] }
    /** 주소는 다르지만 도메인이 우리 발신 도메인이다 — 스레드가 우리 발송에 이어질 때만 우리 것 (domain_thread) */
    | { kind: "domain"; address: string; domain: string; orgIds: string[] }
    | { kind: "none" };

/**
 * 받는 사람 머리글만으로 "우리 것"을 가른다 (4-2 3번). 메일함 주소와 메일함 쪽 도메인 위의 값은 판정에 쓰지 않는다 —
 * Delivered-To·X-Original-To는 메일함의 모든 메일에서 메일함 주소라 그 값으로는 아무것도 우리 것이 되지 않는다 (B1).
 * 주소 일치가 하나라도 있으면 도메인 후보보다 먼저다.
 */
export function recipientOwnership(headers: readonly GmailHeader[], set: OurAddressSet): Ownership {
    let domainHit: Extract<Ownership, { kind: "domain" }> | null = null;
    for (const name of RECIPIENT_HEADERS) {
        for (const value of headerValues(headers, name)) {
            for (const parsed of parseAddressList(value)) {
                const a = normalizeReplyAddress(parsed.address);
                const orgIds = set.addresses.get(a);
                if (orgIds) return { kind: "address", address: a, orgIds: [...orgIds] };
                if (set.mailboxAddresses.has(a)) continue;
                const domain = domainOfAddress(a);
                if (set.mailboxDomains.has(domain)) continue;
                const domainOrgs = set.domains.get(domain);
                if (domainOrgs && !domainHit) domainHit = { kind: "domain", address: a, domain, orgIds: [...domainOrgs] };
            }
        }
    }
    return domainHit ?? { kind: "none" };
}

/** Gmail 라벨로 1단계 전에 버리는 메일 (우리가 보낸 것·임시 저장·채팅) */
export function isSkippedLabel(labelIds: readonly string[] | null | undefined): boolean {
    return (labelIds ?? []).some((l) => l === "SENT" || l === "DRAFT" || l === "CHAT");
}

export function isSpamLabel(labelIds: readonly string[] | null | undefined): boolean {
    return (labelIds ?? []).includes("SPAM");
}

// ============================================
// 스레드 머리글 → 요청 번호 후보 (6-1)
// ============================================

/** 머리글 값의 `<…>` 메시지 번호들 (꺾쇠 없이, 나온 순서) */
export function parseMessageIds(value: string | null | undefined): string[] {
    const out: string[] = [];
    const re = /<([^<>\s]+)>/g;
    for (let m = re.exec(value ?? ""); m; m = re.exec(value ?? "")) out.push(m[1]);
    if (out.length === 0) {
        const bare = (value ?? "").trim();
        if (bare && !/\s/.test(bare) && bare.includes("@")) out.push(bare);
    }
    return out;
}

/** NHN 요청 번호 모양 (예 20210806120100sA3CcWU2 = 14자리 시각 + 8자) */
const NHN_REQUEST_ID_PREFIX_RE = /^\d{14}[A-Za-z0-9]{8}/;

/** 메시지 번호 하나 → 요청 번호 후보: 로컬 부분 전체, 그리고 앞머리가 NHN 요청 번호 모양이면 그 22자 */
export function requestIdCandidatesOf(messageId: string): string[] {
    const at = messageId.lastIndexOf("@");
    const local = (at > 0 ? messageId.slice(0, at) : messageId).trim();
    if (!local) return [];
    const out = [local];
    const m = NHN_REQUEST_ID_PREFIX_RE.exec(local);
    if (m && m[0] !== local) out.push(m[0]);
    return out;
}

/**
 * In-Reply-To·References → 요청 번호 후보 (순서 = 우선순위): In-Reply-To 먼저, 그다음 References의 뒤(가장 최근)부터.
 * 같은 값은 한 번만.
 */
export function threadRequestIdCandidates(
    inReplyTo: readonly string[],
    references: readonly string[]
): string[] {
    const ids = [
        ...inReplyTo.flatMap((v) => parseMessageIds(v)),
        ...references.flatMap((v) => parseMessageIds(v)).reverse(),
    ];
    const out: string[] = [];
    for (const id of ids) for (const c of requestIdCandidatesOf(id)) if (!out.includes(c)) out.push(c);
    return out;
}

export type ThreadPick<L> = { status: "matched"; log: L; requestId: string } | { status: "ambiguous" } | { status: "none" };

/**
 * 후보 순서대로 발송 기록을 찾는다 (6-1). 이어진 발송의 조직이 회신이 온 우리 주소의 조직(allowedOrgIds)에 없으면
 * 이어 붙이지 않는다 (ambiguous). 같은 요청 번호가 허용 조직 둘 이상에 있으면 ambiguous.
 */
export function pickThreadLog<L extends { requestId: string | null; orgId: string }>(
    candidates: readonly string[],
    logs: readonly L[],
    allowedOrgIds: readonly string[]
): ThreadPick<L> {
    for (const c of candidates) {
        const hits = logs.filter((l) => l.requestId === c);
        if (hits.length === 0) continue;
        const allowed = hits.filter((l) => allowedOrgIds.includes(l.orgId));
        if (allowed.length === 0) return { status: "ambiguous" };
        const orgs = new Set(allowed.map((l) => l.orgId));
        if (orgs.size > 1) return { status: "ambiguous" };
        return { status: "matched", log: allowed[0], requestId: c };
    }
    return { status: "none" };
}

// ============================================
// 제목 맞추기·대체 짝짓기 (6-2)
// ============================================

const SUBJECT_PREFIX_RE =
    /^\s*(?:(?:re|fw|fwd|aw|wg|sv|회신|답장|답변|전달)\s*(?:\[\d+\]|\(\d+\))?\s*[:：]|\[(?:외부|external)\]|\((?:광고)\)|\[(?:광고)\])\s*/i;

/** 제목 비교 모양: Re:·RE:·Fw:·Fwd:·회신:·답장:·전달:·[외부]·[EXTERNAL]·(광고) 앞머리를 되풀이해 떼고 공백을 하나로, 소문자 */
export function normalizeSubject(subject: string | null | undefined): string {
    let t = (subject ?? "").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 20; i++) {
        const next = t.replace(SUBJECT_PREFIX_RE, "").trim();
        if (next === t) break;
        t = next;
    }
    return t.toLowerCase();
}

export function subjectsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    const x = normalizeSubject(a);
    return x !== "" && x === normalizeSubject(b);
}

/** 6-2 조회 결과 한 줄 (워커가 DB에서 읽어 채운다) */
export interface FallbackLogCandidate {
    id: number;
    orgId: string;
    workspaceId: number | null;
    recipientEmail: string;
    /** 보낼 때 쓴 주소 (0073 전 기록은 NULL) */
    senderEmail: string | null;
    /** sender_profile_id 프로필의 지금 주소 (senderEmail이 NULL일 때 쓴다) */
    profileFromEmail: string | null;
    subject: string | null;
    sentAt: Date;
}

export type FallbackPick<L> =
    | { status: "matched"; log: L; method: "fallback_subject" | "fallback_latest" | "fallback_from_only" }
    | { status: "ambiguous"; method: "fallback_multi_ws" | "fallback_multi_org" }
    | { status: "unmatched" };

function latestOf<L extends { sentAt: Date; id: number }>(logs: readonly L[]): L {
    return [...logs].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime() || b.id - a.id)[0];
}

/**
 * 스레드 머리글로 못 이은 회신의 대체 짝짓기 (6-2, M4). 조건(모두):
 *   보낸 사람 = 발송 받는 사람 · 받은 우리 주소 = 그 발송의 보낸 주소(NULL이면 프로필의 지금 주소, 둘 다 없으면 이 조건 없이 from_only)
 *   · 도착 전 60일 안 · 조직 = 그 우리 주소의 조직
 * 고르기: 후보가 한 워크스페이스면 제목이 같은 것 중 가장 최근 → 없으면 가장 최근.
 * 여러 워크스페이스면 제목이 같은 후보가 한 워크스페이스에만 있을 때만 그 안에서 고르고, 아니면 ambiguous —
 * "가장 최근"으로 엉뚱한 사업에 붙여 그 사업만 멈추는 일을 하지 않는다. 조직이 둘 이상이면 ambiguous (R20).
 */
export function pickFallbackLog<L extends FallbackLogCandidate>(input: {
    logs: readonly L[];
    from: string;
    toAddress: string;
    orgIds: readonly string[];
    receivedAt: Date;
    subject: string | null;
}): FallbackPick<L> {
    const from = normalizeReplyAddress(input.from);
    const to = normalizeReplyAddress(input.toAddress);
    const since = input.receivedAt.getTime() - MATCH_WINDOW_DAYS * DAY_MS;
    const until = input.receivedAt.getTime();

    const eligible = input.logs.filter((l) => {
        if (!input.orgIds.includes(l.orgId)) return false;
        if (normalizeReplyAddress(l.recipientEmail) !== from) return false;
        const t = l.sentAt.getTime();
        if (t < since || t > until) return false;
        const sender = l.senderEmail ?? l.profileFromEmail;
        return sender === null || normalizeReplyAddress(sender) === to;
    });
    if (eligible.length === 0) return { status: "unmatched" };
    if (new Set(eligible.map((l) => l.orgId)).size > 1) return { status: "ambiguous", method: "fallback_multi_org" };

    const methodOf = (log: L, subjectHit: boolean): "fallback_subject" | "fallback_latest" | "fallback_from_only" =>
        (log.senderEmail ?? log.profileFromEmail) === null ? "fallback_from_only" : subjectHit ? "fallback_subject" : "fallback_latest";

    const wsKey = (l: L) => (l.workspaceId === null ? "none" : String(l.workspaceId));
    const subjectHits = eligible.filter((l) => subjectsMatch(l.subject, input.subject));
    const workspaces = new Set(eligible.map(wsKey));
    if (workspaces.size === 1) {
        if (subjectHits.length > 0) {
            const log = latestOf(subjectHits);
            return { status: "matched", log, method: methodOf(log, true) };
        }
        const log = latestOf(eligible);
        return { status: "matched", log, method: methodOf(log, false) };
    }
    if (subjectHits.length > 0 && new Set(subjectHits.map(wsKey)).size === 1) {
        const log = latestOf(subjectHits);
        return { status: "matched", log, method: methodOf(log, true) };
    }
    return { status: "ambiguous", method: "fallback_multi_ws" };
}

// ============================================
// 분류 (5절)
// ============================================

export type ReplyKind = "human" | "auto_reply" | "bounce" | "system" | "internal" | "unknown";
export const REPLY_KINDS: readonly ReplyKind[] = ["human", "auto_reply", "bounce", "system", "internal", "unknown"];

export interface ContentType {
    type: string;
    params: Record<string, string>;
}

/** Content-Type 머리글 값 → { type(소문자), params(이름 소문자) } */
export function parseContentType(value: string | null | undefined): ContentType {
    const parts = (value ?? "").split(";");
    const type = (parts.shift() ?? "").trim().toLowerCase();
    const params: Record<string, string> = {};
    for (const p of parts) {
        const eq = p.indexOf("=");
        if (eq < 0) continue;
        const k = p.slice(0, eq).trim().toLowerCase();
        const v = p.slice(eq + 1).trim().replace(/^"([\s\S]*)"$/, "$1");
        if (k) params[k] = v;
    }
    return { type, params };
}

const DAEMON_LOCAL_PARTS = new Set(["mailer-daemon", "postmaster", "mail-daemon"]);

export function isDaemonAddress(address: string | null | undefined): boolean {
    return DAEMON_LOCAL_PARTS.has(localPartOf(address));
}

const BOUNCE_SUBJECT_RE =
    /(undeliver|delivery status notification|mail delivery failed|returned mail|failure notice|메일\s*(발송|전송|전달)\s*실패|반송)/i;
const AUTO_REPLY_SUBJECT_RE =
    /^(자동\s*(회신|응답)|\[?자동응답\]?|부재\s*중|automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|ooo\b)/i;

export interface ClassifyInput {
    headers: readonly GmailHeader[];
    /** 정규화한 보낸 사람 주소 */
    from: string;
    /** 푼 제목 */
    subject: string;
}

export interface ClassifyContext {
    /** 그 조직 사용자 주소 (정규화) */
    orgUserEmails: ReadonlySet<string>;
    /** 메일함 쪽 도메인 (4-1) */
    mailboxDomains: ReadonlySet<string>;
}

export interface Classification {
    kind: ReplyKind;
    /** 최상위가 multipart/report면 report-type (소문자) */
    reportType: string | null;
}

/**
 * 5절 분류 — 순서대로 처음 맞는 것. 애매하면 사람 회신으로 둔다 (M5): 잘못 멈추는 손해가 회신을 놓치는 손해보다 작다.
 *   bounce: multipart/report;report-type=delivery-status · From이 mailer-daemon·postmaster·mail-daemon ·
 *           Return-Path <> 이면서 반송 제목. 제목 말만으로는 반송이 아니다 ("Re: 제품 반송 문의"는 사람)
 *   system: delivery-status가 아닌 multipart/report (읽음 확인·스팸 신고 ARF)
 *   internal: 보낸 사람이 조직 사용자이거나 메일함 쪽 도메인 주소
 *   auto_reply: 자동 머리글 또는 자동응답 제목. 본문 글만으로는 자동응답이 아니다
 *   human: 나머지
 */
export function classifyReply(input: ClassifyInput, ctx: ClassifyContext): Classification {
    const ct = parseContentType(headerValue(input.headers, "Content-Type"));
    const reportType = ct.type === "multipart/report" ? (ct.params["report-type"] ?? "").toLowerCase() : null;
    const returnPath = (headerValue(input.headers, "Return-Path") ?? "").trim();
    const nullReturnPath = returnPath === "<>";
    const subject = input.subject.trim();

    if (reportType === "delivery-status") return { kind: "bounce", reportType };
    if (isDaemonAddress(input.from)) return { kind: "bounce", reportType };
    if (nullReturnPath && BOUNCE_SUBJECT_RE.test(subject)) return { kind: "bounce", reportType };

    if (reportType !== null) return { kind: "system", reportType };

    const from = normalizeReplyAddress(input.from);
    if (ctx.orgUserEmails.has(from) || ctx.mailboxDomains.has(domainOfAddress(from))) {
        return { kind: "internal", reportType };
    }

    const autoSubmitted = headerValue(input.headers, "Auto-Submitted");
    const precedence = (headerValue(input.headers, "Precedence") ?? "").trim().toLowerCase();
    const autoHeaders =
        (autoSubmitted !== null && autoSubmitted.trim().toLowerCase() !== "no") ||
        headerValue(input.headers, "X-Autoreply") !== null ||
        headerValue(input.headers, "X-Autorespond") !== null ||
        ["auto_reply", "bulk", "junk", "list"].includes(precedence) ||
        nullReturnPath;
    if (autoHeaders || AUTO_REPLY_SUBJECT_RE.test(subject)) return { kind: "auto_reply", reportType };

    return { kind: "human", reportType };
}

// ============================================
// 반송 안내 (5절 "반송 자세히")
// ============================================

export interface DsnRecipient {
    /** Final-Recipient (rfc822; 를 뗀 주소, 소문자) */
    finalRecipient: string | null;
    originalRecipient: string | null;
    /** failed | delayed | delivered | relayed | expanded (소문자) */
    action: string | null;
    /** "5.1.1" 같은 상태 */
    status: string | null;
    /** Diagnostic-Code 앞 300자 */
    diagnostic: string | null;
}

/** 접힌 머리글 줄을 펴고 블록(빈 줄로 가름)마다 [이름(소문자), 값] 목록 */
function parseFieldBlocks(text: string): Array<Array<[string, string]>> {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const blocks: Array<Array<[string, string]>> = [];
    let cur: Array<[string, string]> = [];
    for (const line of lines) {
        if (line.trim() === "") {
            if (cur.length > 0) blocks.push(cur);
            cur = [];
            continue;
        }
        if (/^[ \t]/.test(line) && cur.length > 0) {
            cur[cur.length - 1][1] += " " + line.trim();
            continue;
        }
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        cur.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
    }
    if (cur.length > 0) blocks.push(cur);
    return blocks;
}

function dsnAddress(value: string | undefined): string | null {
    if (!value) return null;
    const semi = value.indexOf(";");
    const raw = (semi >= 0 ? value.slice(semi + 1) : value).trim().replace(/^<|>$/g, "");
    const a = normalizeEmail(raw);
    return isAddress(a) ? a : null;
}

const DSN_STATUS_RE = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/;

/**
 * message/delivery-status 부분 → 수신자 묶음마다 Final/Original-Recipient·Action·Status·Diagnostic-Code.
 * Status가 없으면 Diagnostic-Code 안의 x.y.z를 쓴다.
 */
export function parseDeliveryStatus(text: string | null | undefined): DsnRecipient[] {
    if (!text) return [];
    const out: DsnRecipient[] = [];
    for (const block of parseFieldBlocks(text)) {
        const get = (name: string) => block.find(([k]) => k === name)?.[1];
        const finalRecipient = dsnAddress(get("final-recipient"));
        const originalRecipient = dsnAddress(get("original-recipient"));
        const actionRaw = get("action");
        if (!finalRecipient && !originalRecipient && actionRaw === undefined) continue;
        const diagnosticRaw = get("diagnostic-code");
        const diagnostic = diagnosticRaw ? Array.from(diagnosticRaw.replace(/\s+/g, " ").trim()).slice(0, 300).join("") : null;
        const statusMatch = DSN_STATUS_RE.exec(get("status") ?? "") ?? DSN_STATUS_RE.exec(diagnostic ?? "");
        out.push({
            finalRecipient,
            originalRecipient,
            action: actionRaw ? actionRaw.trim().toLowerCase().split(/\s/)[0] : null,
            status: statusMatch ? statusMatch[0] : null,
            diagnostic,
        });
    }
    return out;
}

export type BounceType = "hard" | "expired" | "soft" | "unknown";

/** 반송 등급은 SND classifyDsn 하나로 (B2). 수신자가 여럿이면 가장 무거운 것 */
export function bounceTypeOf(recipients: readonly DsnRecipient[]): BounceType {
    if (recipients.length === 0) return "unknown";
    const order: BounceType[] = ["hard", "expired", "soft", "unknown"];
    let best: BounceType = "unknown";
    for (const r of recipients) {
        const k = classifyDsn(r.action, r.status) as BounceType;
        if (order.indexOf(k) < order.indexOf(best)) best = k;
    }
    return best;
}

/** 머리글 블록(첫 빈 줄 앞)에서 Message-ID. 본문은 보지 않는다 */
export function originalMessageIdOf(headerText: string | null | undefined): string | null {
    if (!headerText) return null;
    const head = headerText.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)[0];
    const blocks = parseFieldBlocks(head);
    for (const block of blocks) {
        const v = block.find(([k]) => k === "message-id")?.[1];
        if (v) return parseMessageIds(v)[0] ?? null;
    }
    return null;
}

/** ARF(message/feedback-report)의 받는 주소 (Original-Rcpt-To). 없으면 null */
export function feedbackRecipientOf(text: string | null | undefined): string | null {
    if (!text) return null;
    for (const block of parseFieldBlocks(text)) {
        const v = block.find(([k]) => k === "original-rcpt-to")?.[1];
        const a = v ? dsnAddress(v) : null;
        if (a) return a;
    }
    return null;
}

// ============================================
// MIME 부분 (4-2 2단계, M9)
// ============================================

/** Gmail API messages.get의 payload (필요한 칸만) */
export interface GmailPart {
    partId?: string;
    mimeType?: string;
    filename?: string;
    headers?: GmailHeader[];
    body?: { attachmentId?: string; size?: number; data?: string };
    parts?: GmailPart[];
}

/** 반송·시스템 안내의 보고 부분 형식 4가지 — 이것만 첨부 모양이어도 받는다 */
export const REPORT_PART_TYPES = ["message/delivery-status", "message/rfc822", "text/rfc822-headers", "message/feedback-report"] as const;

function partType(p: GmailPart): string {
    if (p.mimeType) return p.mimeType.toLowerCase();
    return parseContentType(headerValue(p.headers, "Content-Type")).type;
}

function walkParts(p: GmailPart, visit: (part: GmailPart) => void): void {
    visit(p);
    for (const child of p.parts ?? []) walkParts(child, visit);
}

/** 최상위가 multipart/report이거나 From이 mailer-daemon·postmaster·mail-daemon인 메일 (보고 부분 예외 대상) */
export function isReportLikeMessage(payload: GmailPart, fromAddress: string): boolean {
    return (payload.mimeType ?? "").toLowerCase() === "multipart/report" || isDaemonAddress(fromAddress);
}

export interface ReportPartRef {
    partId: string;
    attachmentId: string;
    mimeType: string;
    size: number;
}

/**
 * 첨부(attachmentId)로만 온 보고 부분 중 받을 것 (M9). 보고 메일이 아니면 늘 빈 목록이다.
 * 4가지 형식·body.data 없음·64KB 이하만. 그 밖의 첨부(파일·이미지)는 어떤 경우에도 받지 않는다.
 */
export function reportPartsToFetch(payload: GmailPart, fromAddress: string): ReportPartRef[] {
    if (!isReportLikeMessage(payload, fromAddress)) return [];
    const out: ReportPartRef[] = [];
    walkParts(payload, (p) => {
        const type = partType(p);
        if (!(REPORT_PART_TYPES as readonly string[]).includes(type)) return;
        const body = p.body ?? {};
        if (body.data || !body.attachmentId) return;
        // message/rfc822를 Gmail이 안쪽 부분으로 풀어 준 경우는 그 머리글을 쓴다 — 받지 않는다
        if (type === "message/rfc822" && (p.parts?.length ?? 0) > 0) return;
        const size = Number(body.size ?? 0);
        if (!(size > 0 && size <= REPORT_PART_MAX_BYTES)) return;
        out.push({ partId: p.partId ?? "", attachmentId: body.attachmentId, mimeType: type, size });
    });
    return out;
}

/** base64url 본문 → 글자 (charset으로 읽음) */
export function decodePartData(data: string | null | undefined, charset: string | null | undefined): string {
    if (!data) return "";
    return decodeBytes(base64ToBytes(data), charset);
}

function charsetOf(p: GmailPart): string | null {
    const header = headerValue(p.headers, "Content-Type");
    return header ? parseContentType(header).params["charset"] ?? null : null;
}

function isAttachmentPart(p: GmailPart): boolean {
    if ((p.filename ?? "").trim() !== "") return true;
    const disposition = (headerValue(p.headers, "Content-Disposition") ?? "").trim().toLowerCase();
    return disposition.startsWith("attachment");
}

export interface ExtractedBodies {
    /** 첨부가 아닌 첫 text/plain */
    text: string | null;
    /** 첨부가 아닌 첫 text/html */
    html: string | null;
    /** message/delivery-status */
    deliveryStatus: string | null;
    /** 원본 메일 머리글 (text/rfc822-headers 또는 message/rfc822의 머리글만 — 본문은 바로 버린다) */
    originalHeaders: string | null;
    /** message/feedback-report (ARF) */
    feedbackReport: string | null;
}

function headerBlockOnly(text: string): string {
    return text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)[0];
}

/** message/rfc822 안쪽(원본 메일 본문)으로 내려가지 않게 안쪽 첫 부분의 머리글만 남긴다 */
function pruneEncapsulated(p: GmailPart): GmailPart {
    if (partType(p) === "message/rfc822") {
        const inner = p.parts?.[0]?.headers;
        return { ...p, parts: inner ? [{ headers: inner }] : undefined };
    }
    return p.parts ? { ...p, parts: p.parts.map(pruneEncapsulated) } : p;
}

/** 글 처리 전에 자른다 (BODY_SCAN_MAX_CHARS) */
function clipForScan(text: string): string {
    return text.length > BODY_SCAN_MAX_CHARS ? text.slice(0, BODY_SCAN_MAX_CHARS) : text;
}

/**
 * 본문 부분 고르기 (2단계). fetchedParts는 reportPartsToFetch로 받은 첨부 부분 (attachmentId → base64url data).
 * 첨부 파일은 보지 않는다. message/rfc822는 머리글만 남기고 안쪽 본문(우리 원래 메일)은 읽지 않는다.
 * 고른 부분은 모두 앞 BODY_SCAN_MAX_CHARS 글자로 자른다 — 뒤의 글 처리(인용 떼기·태그 걷기·반송 안내 해석)가 길이에 묶이게 (RH-SEC-1)
 */
export function extractBodies(payload: GmailPart, fetchedParts: ReadonlyMap<string, string> = new Map()): ExtractedBodies {
    const out: ExtractedBodies = { text: null, html: null, deliveryStatus: null, originalHeaders: null, feedbackReport: null };
    const decode = (data: string, p: GmailPart) => clipForScan(decodePartData(data, charsetOf(p)));
    walkParts(pruneEncapsulated(payload), (p) => {
        const type = partType(p);
        const data = p.body?.data ?? (p.body?.attachmentId ? fetchedParts.get(p.body.attachmentId) : undefined);
        if (type === "message/delivery-status") {
            if (out.deliveryStatus === null && data) out.deliveryStatus = decode(data, p);
            return;
        }
        if (type === "message/feedback-report") {
            if (out.feedbackReport === null && data) out.feedbackReport = decode(data, p);
            return;
        }
        if (type === "text/rfc822-headers") {
            if (out.originalHeaders === null && data) out.originalHeaders = headerBlockOnly(decode(data, p));
            return;
        }
        if (type === "message/rfc822") {
            if (out.originalHeaders !== null) return;
            if (data) out.originalHeaders = headerBlockOnly(decode(data, p));
            else {
                // Gmail이 안쪽 메일을 부분으로 풀어 준 경우: 안쪽 첫 부분의 머리글
                const inner = p.parts?.[0]?.headers ?? [];
                if (inner.length > 0) out.originalHeaders = clipForScan(inner.map((h) => `${h.name}: ${h.value}`).join("\n"));
            }
            return;
        }
        if (isAttachmentPart(p) || !p.body?.data) return;
        if (type === "text/plain" && out.text === null) out.text = decode(p.body.data, p);
        else if (type === "text/html" && out.html === null) out.html = decode(p.body.data, p);
    });
    return out;
}

// ============================================
// 발췌 (5절 "본문에서 발췌 만들기", m4)
// ============================================

/**
 * 인용 시작 요소. 태그 안 글자는 `[^<>]{0,2000}`로 묶는다 — `[^>]*`는 `<a <a <a …`(`>` 없음) 같은 글에서
 * 시작 위치마다 끝까지 훑어 처리 시간이 길이의 제곱으로 는다 (RH-SEC-1). 태그 하나가 2,000자를 넘으면 인용으로 보지 않는다
 */
const HTML_QUOTE_START_RE =
    /<blockquote\b|<[a-z][a-z0-9]*\b[^<>]{0,2000}?(?:\bclass\s*=\s*["'][^"'<>]{0,2000}\b(?:gmail_quote(?:_container)?|yahoo_quoted)\b[^"'<>]{0,2000}["']|\bid\s*=\s*["'](?:divRplyFwdMsg|appendonsend)["'])[^<>]{0,2000}>/i;

/** HTML 인용 떼기: 처음 나오는 blockquote·.gmail_quote·#divRplyFwdMsg·#appendonsend·.yahoo_quoted 요소와 그 뒤 전부를 버린다 */
export function stripHtmlQuote(html: string): string {
    const m = HTML_QUOTE_START_RE.exec(html);
    return m ? html.slice(0, m.index) : html;
}

const ENTITY_MAP: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

function decodeEntities(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
        const lower = name.toLowerCase();
        if (lower.startsWith("#x")) {
            const n = parseInt(lower.slice(2), 16);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
        }
        if (lower.startsWith("#")) {
            const n = parseInt(lower.slice(1), 10);
            return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
        }
        return ENTITY_MAP[lower] ?? whole;
    });
}

/** 주석(<!-- … -->)을 지운다. 닫히지 않은 주석은 그 뒤를 모두 버린다 (브라우저와 같다). indexOf로 한 번 훑는다 */
function removeHtmlComments(html: string): string {
    let out = "";
    let i = 0;
    for (;;) {
        const start = html.indexOf("<!--", i);
        if (start < 0) return out + html.slice(i);
        out += html.slice(i, start);
        const end = html.indexOf("-->", start + 4);
        if (end < 0) return out;
        i = end + 3;
    }
}

/** from부터 처음 나오는 `</name 공백* >`가 끝나는 위치. 없으면 -1 (lower = 소문자로 바꾼 글) */
function closingTagEnd(lower: string, name: string, from: number): number {
    const needle = `</${name}`;
    let at = lower.indexOf(needle, from);
    while (at >= 0) {
        let j = at + needle.length;
        while (j < lower.length && (lower[j] === " " || lower[j] === "\t" || lower[j] === "\n" || lower[j] === "\r" || lower[j] === "\f")) j++;
        if (lower[j] === ">") return j + 1;
        at = lower.indexOf(needle, j);
    }
    return -1;
}

/**
 * head·style·script·title 요소를 통째로 지운다. 닫는 태그가 없으면 그대로 둔다 (예전 정규식과 같다).
 * `<(style)\b[\s\S]*?<\/\1\s*>` 꼴 정규식은 닫는 태그 없는 시작 태그가 많으면 시작마다 끝까지 훑는다 — 이름마다 한 번만 끝까지 찾는다
 */
function removeHtmlBlocks(html: string): string {
    const lower = html.toLowerCase();
    const re = /<(head|style|script|title)\b/gi;
    const unclosed = new Set<string>();
    let out = "";
    let last = 0;
    for (let m = re.exec(html); m; m = re.exec(html)) {
        const name = m[1].toLowerCase();
        if (unclosed.has(name)) continue;
        const end = closingTagEnd(lower, name, m.index + m[0].length);
        if (end < 0) {
            unclosed.add(name);
            continue;
        }
        out += html.slice(last, m.index);
        last = end;
        re.lastIndex = end;
    }
    return out + html.slice(last);
}

/**
 * HTML → 글 (태그·스타일·스크립트를 걷어낸다). 인용 떼기는 이 앞에 한다.
 * 모든 단계가 글 길이에 비례해 끝난다 — 태그는 `<[^<>]+>`(안에 < 없음)로만 지운다 (RH-SEC-1)
 */
export function htmlToText(html: string): string {
    return decodeEntities(
        removeHtmlBlocks(removeHtmlComments(clipForScan(html)))
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol|section|article)\s*>/gi, "\n")
            .replace(/<[^<>]+>/g, "")
    );
}

const CUT_LINE_RES: RegExp[] = [
    /^-{2,}\s*original message\s*-{2,}/i,
    /^-{2,}\s*원본\s*메시지\s*-{2,}/,
    /^-{2,}\s*forwarded message\s*-{2,}/i,
    /^-{2,}\s*전달된\s*메시지\s*-{2,}/,
    /^-{2,}\s*원본 메일\s*-{2,}/,
];
const ON_WROTE_RE = /^on\s.+wrote:\s*$/i;
const KO_WROTE_RE = /^\d{4}\s*(?:\.|년)\s*\d{1,2}\s*(?:\.|월)\s*\d{1,2}\s*(?:\.|일)?.*작성:?\s*$/;
const FROM_HEAD_RE = /^\s*\*?(from|보낸\s*사람)\s*\*?\s*:/i;
const FROM_FOLLOW_RE = /^\s*\*?(sent|date|보낸\s*날짜|받는\s*사람)\s*\*?\s*:/i;

/**
 * 인용 떼기 (글). `>` 줄은 지우고, 원본 메시지·전달 구분줄, "On … wrote:"(두 줄에 걸쳐도), "… 작성:",
 * From:/보낸 사람: 다음 4줄 안에 Sent:/Date:/보낸 날짜:/받는 사람:이 있는 머리 블록에서 그 뒤를 모두 버린다.
 */
export function stripQuoted(text: string): string {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        if (CUT_LINE_RES.some((re) => re.test(t))) break;
        if (ON_WROTE_RE.test(t) || KO_WROTE_RE.test(t)) break;
        const next = (lines[i + 1] ?? "").trim();
        if (/^on\s/i.test(t) && !/wrote:\s*$/i.test(t) && /wrote:\s*$/i.test(next)) break;
        if (/^\d{4}\s*(?:\.|년)/.test(t) && !/작성:?\s*$/.test(t) && /작성:?\s*$/.test(next) && KO_WROTE_RE.test(`${t} ${next}`)) break;
        if (FROM_HEAD_RE.test(t) && lines.slice(i + 1, i + 5).some((l) => FROM_FOLLOW_RE.test(l.trim()))) break;
        if (t.startsWith(">")) continue;
        kept.push(line);
    }
    // 인용 앞에 남은 구분선(Outlook ____·----)과 빈 줄을 끝에서 지운다. 앞뒤 공백을 먼저 떼고 본다 —
    // `^\s*(…|)\s*$`는 긴 공백 뒤에 글자가 있는 줄에서 처리 시간이 길이의 제곱으로 는다 (RH-SEC-1)
    while (kept.length > 0 && /^(?:[_\-=*]{3,})?$/.test(kept[kept.length - 1].trim())) kept.pop();
    return kept.join("\n");
}

const OUR_FOOTER_LINE_RE = /(이 메일을 더 이상 받고 싶지 않으시면|수신거부를\s*눌러\s*주세요)/;
/** 수신거부 경로 URL. 주소 부분은 500자까지만 — `\S*`는 `http://http://…` 한 줄에서 처리 시간이 길이의 제곱으로 는다 (RH-SEC-1) */
const UNSUBSCRIBE_URL_RE = /https?:\/\/\S{0,500}\/(?:api\/email\/)?unsubscribe\b/i;

/** 우리 꼬리말 문장이 든 줄과 수신거부 경로 URL 줄을 지운다 (m4) — 수신거부 말 검사 전에 */
export function stripOurFooter(text: string): string {
    return text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter(
            (line) =>
                !OUR_FOOTER_LINE_RE.test(line) && !(line.toLowerCase().includes("unsubscribe") && UNSUBSCRIBE_URL_RE.test(line))
        )
        .join("\n");
}

function clipChars(value: string, max: number): string {
    const chars = Array.from(value);
    return chars.length > max ? chars.slice(0, max).join("") : value;
}

/** 공백 정리 뒤 max자 (코드 포인트로 센다). 줄바꿈은 두 줄까지 남긴다 */
export function makeExcerpt(text: string | null | undefined, max: number = EXCERPT_MAX_CHARS): string {
    const cleaned = (text ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t 　]+/g, " ")
        .split("\n")
        .map((l) => l.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return clipChars(cleaned, max);
}

/**
 * 회신 본문 → 인용·우리 꼬리말을 뗀 글. text/plain이 있으면 그것, 없으면 text/html에서 인용 요소를 먼저 버리고 글로.
 */
export function replyTextOf(bodies: Pick<ExtractedBodies, "text" | "html">): string {
    // extractBodies가 이미 잘랐지만 다른 곳에서 불러도 길이에 묶이게 한 번 더 자른다 (RH-SEC-1)
    if (bodies.text !== null && bodies.text.trim() !== "") return stripOurFooter(stripQuoted(clipForScan(bodies.text)));
    if (bodies.html !== null) return stripOurFooter(stripQuoted(htmlToText(stripHtmlQuote(clipForScan(bodies.html)))));
    return "";
}

const UNSUBSCRIBE_HINT_RE =
    /(수신\s*거부|그만\s*(보내|받)|보내지\s*(마|말)|메일\s*사절|빼\s*주(세요|십시오)|unsubscribe|remove me|stop (sending|emailing))/i;

/** 수신거부 말 (표시만, 5절). 제목과 인용·꼬리말을 뗀 발췌에서 본다 */
export function hasUnsubscribeHint(subject: string | null | undefined, cleanedText: string | null | undefined): boolean {
    const subj = normalizeSubject(subject);
    return UNSUBSCRIBE_HINT_RE.test(subj) || UNSUBSCRIBE_HINT_RE.test(cleanedText ?? "");
}

// ============================================
// DB 오류 (M6)
// ============================================

/** 메일 하나의 데이터 오류 (22xxx 데이터·23xxx 제약) — 그 메일만 최소 줄로 남기고 넘어간다 */
export function isDataError(sqlState: string | null | undefined): boolean {
    return /^2[23][0-9A-Z]{3}$/.test(sqlState ?? "");
}

/**
 * postgres-js가 연결이 끊기거나 맺어지지 않을 때 주는 code (SQLSTATE가 아니다 — node_modules/postgres/src/connection.js)와
 * 소켓 오류 code. 이것도 연결 오류다 (RH-SEC-3)
 */
const DRIVER_CONNECTION_CODES = new Set([
    "CONNECTION_CLOSED",
    "CONNECTION_ENDED",
    "CONNECTION_DESTROYED",
    "CONNECT_TIMEOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "ECONNABORTED",
    "EPIPE",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
]);

/**
 * 연결·자원 오류 — 회차를 멈추고 커서를 그 묶음 앞에 둔다. SQLSTATE 08·53·57과 드라이버·소켓의 연결 code.
 * 이것을 데이터 오류로 잘못 보면 사람 회신이 '알 수 없음' 최소 줄로 남고 멈춤이 걸리지 않는다 (RH-SEC-3)
 */
export function isConnectionError(code: string | null | undefined): boolean {
    const c = code ?? "";
    return /^(08|53|57)[0-9A-Z]{3}$/.test(c) || DRIVER_CONNECTION_CODES.has(c);
}

/** process_error 칸 값: SQLSTATE와 제약 이름만 (값·제목 없음) */
export function processErrorText(sqlState: string, constraint: string | null | undefined): string {
    return `${sqlState}${constraint ? ` ${constraint}` : ""}`.slice(0, 80);
}

export interface PgErrorInfo {
    code: string;
    message: string;
    constraint: string | null;
    table: string | null;
}

/** drizzle이 감싼 오류(DrizzleQueryError.cause)까지 내려가 Postgres 오류를 찾는다 */
export function pgErrorOf(e: unknown): PgErrorInfo | null {
    let cur: unknown = e;
    for (let depth = 0; depth < 5 && cur; depth++) {
        if (typeof cur === "object" && cur !== null && typeof (cur as { code?: unknown }).code === "string") {
            const o = cur as { code: string; message?: unknown; constraint_name?: unknown; constraint?: unknown; table_name?: unknown };
            const constraint = typeof o.constraint_name === "string" ? o.constraint_name : typeof o.constraint === "string" ? o.constraint : null;
            return {
                code: o.code,
                message: typeof o.message === "string" ? o.message : "",
                constraint,
                table: typeof o.table_name === "string" ? o.table_name : null,
            };
        }
        cur = (cur as { cause?: unknown }).cause;
    }
    return null;
}

/**
 * 로그용 오류 설명. 오류 객체를 통째로 찍지 않는다 — 실패한 쿼리 오류의 메시지에는 매개변수(발췌·제목·주소)가 그대로 들어 있다.
 * Postgres 오류는 SQLSTATE와 짧은 글만, 쿼리 오류는 "쿼리 실패"만.
 */
export function describeReplyError(e: unknown): string {
    const pg = pgErrorOf(e);
    if (pg) return `${pg.code}: ${pg.message}`.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[주소]").slice(0, 200);
    if (e instanceof Error && !("query" in e)) return e.message.replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[주소]").slice(0, 200);
    return "쿼리 실패";
}

// ============================================
// 규칙·단계 (6-4)
// ============================================

export type RuleKind = "ai" | "template" | "manual";

/** 첫 메일의 규칙: AI 규칙 → 템플릿 규칙 → 둘 다 없으면 manual */
export function ruleOf(root: { autoPersonalizedLinkId: number | null; templateLinkId: number | null }): { kind: RuleKind; id: number | null } {
    if (root.autoPersonalizedLinkId !== null) return { kind: "ai", id: root.autoPersonalizedLinkId };
    if (root.templateLinkId !== null) return { kind: "template", id: root.templateLinkId };
    return { kind: "manual", id: null };
}

/** 카드 단계 글자: "첫 메일" / "n번째 후속 (첫 메일 +d일)" */
export function stepLabel(stepIndex: number | null | undefined, rootSentAt: Date | null, sentAt: Date | null): string {
    const n = stepIndex ?? 0;
    if (n <= 0) return "첫 메일";
    const d = rootSentAt && sentAt ? Math.max(0, Math.round((sentAt.getTime() - rootSentAt.getTime()) / DAY_MS)) : null;
    return d === null ? `${n}번째 후속` : `${n}번째 후속 (첫 메일 +${d}일)`;
}

// ============================================
// 효과 계획 (7절 — 멈춤 계획)
// ============================================

export type MatchStatus = "matched" | "unmatched" | "ambiguous";

export interface ReplyEffectTarget {
    kind: ReplyKind | string;
    matchStatus: MatchStatus | string;
    orgId: string | null;
    workspaceId: number | null;
    recordId: number | null;
    contactEmail: string;
    matchedRecipient: string | null;
}

export interface ReplyEffectsPlan {
    /** 사람 회신 7-2: 같은 조직·같은 사업·같은 주소의 pending·held 자동 메일을 멈춘다 */
    stop: boolean;
    /** 멈춤 SQL의 $emails — 두 주소(보낸 사람·원래 받은 사람)의 소문자 값과 +태그를 뗀 값 (M3) */
    emails: string[];
    /** 템플릿 대기열·발송 대기열은 레코드로 멈춘다 (레코드가 있을 때만) */
    recordId: number | null;
    /** 레코드 사건 'reply' (레코드가 있을 때만, M6) */
    recordEvent: boolean;
    /** 반송: 발송 기록은 SND recordBounceSignal이 쓴다 (7-3, B2) */
    bounce: boolean;
}

/**
 * 효과 계획 (멈춤 계획). 사람 회신이고 이어졌고(조직·사업 있음) → 멈춤. 반송 → SND. 그 밖(자동응답·시스템·내부·알 수 없음·
 * 못 이음·애매함)은 기록만.
 */
export function planReplyEffects(r: ReplyEffectTarget): ReplyEffectsPlan {
    const none: ReplyEffectsPlan = { stop: false, emails: [], recordId: null, recordEvent: false, bounce: false };
    if (r.kind === "bounce") return { ...none, bounce: true };
    if (r.kind !== "human" || r.matchStatus !== "matched" || !r.orgId || r.workspaceId === null) return none;
    const emails: string[] = [];
    for (const v of [...addressVariants(r.contactEmail), ...addressVariants(r.matchedRecipient)]) {
        if (!emails.includes(v)) emails.push(v);
    }
    return {
        stop: emails.length > 0,
        emails,
        recordId: r.recordId,
        recordEvent: r.recordId !== null,
        bounce: false,
    };
}

// ============================================
// 알림 (8절)
// ============================================

export type ReplyAlertTarget = "matched" | "unmatched";

/**
 * 카드 대상: 사람 회신이고 (이어짐이거나 6-3 사업 추정) 그 워크스페이스가 허용 목록에 있음.
 * 자동응답·반송·시스템·내부·애매함은 카드 없음.
 */
export function replyAlertTarget(r: {
    kind: string;
    matchStatus: string;
    workspaceId: number | null;
    workspaceGuessed: boolean;
    allowedWorkspaceIds: readonly number[];
}): ReplyAlertTarget | null {
    if (r.kind !== "human" || r.workspaceId === null || !r.allowedWorkspaceIds.includes(r.workspaceId)) return null;
    if (r.matchStatus === "matched") return "matched";
    if (r.matchStatus === "unmatched" && r.workspaceGuessed) return "unmatched";
    return null;
}

export type ReplyAlertStatus = "pending" | "dry_run" | "skipped";

/**
 * 알림 줄 상태 (효과 차지와 같은 트랜잭션에서 쓴다, m1).
 *   알림 off → 줄 없음(null) · 24시간 넘은 회신 → skipped · 회신 읽기 dry_run 또는 알림 dry_run → dry_run(보내지 않음, 미리보기) · live → pending
 * dry_run 카드는 나중에 live로 바꿔도 보내지 않는다 (R33).
 * 24시간 규칙은 처음 거슬러 읽기·밀린 효과용이다 — 마지막 성공 뒤에 도착한 회신(Gmail 장애로 늦게 읽음)은 오래되어도 카드를 보낸다 (RC-2)
 */
export function replyAlertStatus(opts: {
    syncMode: ReplySyncMode;
    alertMode: ReplyAlertMode;
    receivedAt: Date;
    now: Date;
    /** 회신 읽기 마지막 성공 (없으면 처음 읽기) */
    lastSuccessAt?: Date | null;
}): { status: ReplyAlertStatus; lastError: string | null } | null {
    if (opts.alertMode === "off" || opts.syncMode === "off") return null;
    const missedDuringOutage = !!opts.lastSuccessAt && opts.receivedAt.getTime() > opts.lastSuccessAt.getTime();
    if (opts.now.getTime() - opts.receivedAt.getTime() > ALERT_MAX_AGE_MS && !missedDuringOutage) {
        return { status: "skipped", lastError: OLD_REPLY_ALERT_ERROR };
    }
    if (opts.syncMode !== "on" || opts.alertMode !== "live") return { status: "dry_run", lastError: null };
    return { status: "pending", lastError: null };
}

/**
 * 사용자 값 → 한 줄. `<` `>`를 바꿔 링크·멘션 문법이 끼어들지 못하게 하고 (깊이 알림과 같음),
 * * _ ~ ` 를 비슷한 글자로 바꾸고, 맨 URL을 눌리지 않게 한다 — 고객 발췌의 피싱 주소가 직원 채팅에서 눌리지 않게 (RC-7)
 */
function cleanLine(value: unknown): string {
    return chatSafe(value, { defangUrls: true });
}

function clipWithEllipsis(value: string, max: number): string {
    const chars = Array.from(value);
    return chars.length > max ? chars.slice(0, max).join("") + "…" : value;
}

function truncateMessage(text: string): string {
    const chars = Array.from(text);
    if (chars.length <= REPLY_MESSAGE_MAX_CHARS) return text;
    return chars.slice(0, REPLY_MESSAGE_MAX_CHARS - 1).join("") + "…";
}

export interface StopCounts {
    followups: number;
    automation: number;
    sendQueue: number;
}

/** 멈춘 자동 메일 (0인 항목은 빼고 — RC-11) */
export function stopCountsText(counts: StopCounts | null, preview: boolean): string {
    if (!counts || counts.followups + counts.automation + counts.sendQueue === 0) {
        return preview ? "멈출 자동 메일 없음 (시험 모드)" : "이 고객에게 가던 자동 메일은 없습니다";
    }
    const body = [
        counts.followups ? `후속 ${counts.followups}통` : "",
        counts.automation ? `템플릿 반복 ${counts.automation}건` : "",
        counts.sendQueue ? `발송 대기열 ${counts.sendQueue}건` : "",
    ]
        .filter(Boolean)
        .join(" · ");
    return preview ? `자동 메일 멈출 예정 (시험 모드): ${body}` : `이 고객에게 가던 자동 메일을 멈췄습니다: ${body}`;
}

/** 회신 카드 첫 줄 — 무엇의 기한인지 쓴다 (RC-11). 보낼 때 이 줄을 그때 기준으로 다시 쓴다 (RC-12) */
export function replyDeadlineLine(now: Date): string {
    return `⏰ *답장 기한: ${deadlineText("B", now)}*`;
}

/** 보낼 때 카드 첫 줄(기한)을 보내는 때 기준으로 다시 쓴다 (RC-12) */
export function refreshReplyCardForSend(message: string, now: Date): string {
    const nl = message.indexOf("\n");
    const first = nl >= 0 ? message.slice(0, nl) : message;
    if (!first.startsWith("⏰ *")) return message;
    return replyDeadlineLine(now) + (nl >= 0 ? message.slice(nl) : "");
}

export interface ReplyAlertInput {
    now: Date;
    receivedAt: Date;
    replyId: number;
    baseUrl: string;
    workspaceName: string;
    /** 레코드 칸 (연락 요약) */
    contactFields: AlertEvidence["fields"];
    fromName: string | null;
    fromEmail: string;
    ruleKind: RuleKind | null;
    ruleName: string | null;
    stepText: string;
    recordId: number | null;
    integratedCode: string | null;
    partitionName: string | null;
    excerpt: string | null;
    stopped: StopCounts | null;
    /** dry_run 미리보기 (멈춘 수 대신 "멈출 예정") */
    preview: boolean;
    unsubscribeHint: boolean;
}

/** 8절 카드 (3,800자에서 자름). 그 회신의 인용 뗀 발췌만 — Cc·첨부 이름·다른 메일·우리 원래 본문은 넣지 않는다 */
export function buildReplyAlertMessage(input: ReplyAlertInput): string {
    const base = input.baseUrl.replace(/\/+$/, "");
    const contact = contactSummaryOf(input.contactFields);
    const fromLine = `${cleanLine(input.fromName) || "이름 없음"} ‹${cleanLine(input.fromEmail)}›`;
    const rulePart =
        input.ruleKind === "manual" || input.ruleKind === null
            ? "직접 보낸 메일"
            : `규칙 "${clipWithEllipsis(cleanLine(input.ruleName ?? (input.ruleKind === "ai" ? "AI 규칙" : "템플릿 규칙")), 40)}"`;
    const lines: string[] = [
        replyDeadlineLine(input.now),
        `👤 ${contact || fromLine}`,
        `💬 *${clipWithEllipsis(cleanLine(input.workspaceName), 40)} · 회신* — ${rulePart} · ${cleanLine(input.stepText)}에 회신 (${formatKstShort(input.receivedAt)} 도착)`,
    ];
    // 레코드 담당자가 아닌 동료가 회신했으면 실제로 회신한 사람을 보인다 — 엉뚱한 사람에게 연락하지 않게 (RC-6)
    const fromAddr = cleanLine(input.fromEmail).toLowerCase();
    if (contact && fromAddr && !contact.toLowerCase().includes(fromAddr)) {
        lines.splice(2, 0, `✉️ 회신한 사람: ${fromLine} (레코드 연락처와 다름)`);
    }
    const replyLink = `<${base}/email?tab=replies&reply=${input.replyId}|회신 보기·처리함>`;
    if (input.recordId !== null) {
        const code = cleanLine(input.integratedCode) || "-";
        const partition = input.partitionName ? ` · ${clipWithEllipsis(cleanLine(input.partitionName), 40)}` : "";
        lines.push(`레코드 ${code} (#${input.recordId})${partition}`);
        lines.push(
            `<${base}/records?id=${input.recordId}|레코드 열기> · ${replyLink} · <${base}/records/${input.recordId}/journey|고객 여정>`
        );
    } else {
        lines.push("레코드 없음 (지워진 레코드)");
        lines.push(replyLink);
    }
    lines.push("");
    const excerpt = clipWithEllipsis(cleanLine(input.excerpt ?? ""), CARD_EXCERPT_MAX_CHARS);
    lines.push(`> ${excerpt || "(본문 없음)"}`);
    lines.push(stopCountsText(input.stopped, input.preview));
    if (input.unsubscribeHint) lines.push("⚠️ 수신거부 요청으로 보입니다 — 확인 뒤 수신거부에 넣어 주세요");
    lines.push(REPLY_MESSAGE_FOOTER);
    return truncateMessage(lines.join("\n"));
}

export interface UnmatchedReplyAlertInput {
    now: Date;
    receivedAt: Date;
    replyId: number;
    baseUrl: string;
    workspaceName: string;
    fromName: string | null;
    fromEmail: string;
    toEmail: string;
    subject: string | null;
    excerpt: string | null;
}

/** 6-3 사업 추정 회신 카드 — 기한·자동 메일 상태를 이어진 카드와 같은 말로 (RC-10) */
export function buildUnmatchedReplyAlertMessage(input: UnmatchedReplyAlertInput): string {
    const base = input.baseUrl.replace(/\/+$/, "");
    const lines = [
        replyDeadlineLine(input.now),
        `💬 *${clipWithEllipsis(cleanLine(input.workspaceName), 40)} · 새 회신 (어느 메일의 답장인지 못 찾음)* — ${formatKstShort(input.receivedAt)} 도착`,
        `보낸 사람 ${cleanLine(input.fromName) || "이름 없음"} ‹${cleanLine(input.fromEmail)}› → 받은 주소 ${cleanLine(input.toEmail)}`,
        `제목 "${clipWithEllipsis(cleanLine(input.subject ?? ""), 100)}"`,
        `> ${clipWithEllipsis(cleanLine(input.excerpt ?? ""), CARD_EXCERPT_MAX_CHARS) || "(본문 없음)"}`,
        `<${base}/email?tab=replies&reply=${input.replyId}|회신 보기>`,
        "이 주소로 나갈 자동 메일은 보내기 직전에 막힙니다",
        REPLY_MESSAGE_FOOTER,
    ];
    return truncateMessage(lines.join("\n"));
}

// ============================================
// 운영 알림 (M7)
// ============================================

export type ReplyErrorCode =
    | "auth"
    | "scope"
    | "mailbox_mismatch"
    | "rate_limited"
    | "transient"
    | "config"
    | "db"
    | "stale"
    /** 분류 밖 오류 (스키마 어긋남·코드 예외 — RO-1) */
    | "internal"
    /** 운영 서버인데 REPLY_PRIVATE_DOMAINS가 비어 메일함을 읽지 않음 (RO-13) */
    | "read_blocked";

/** 회신 탭 띠·운영 알림에 쓰는 한국어 이유 (비밀값·주소 없음) */
export function replyErrorText(code: ReplyErrorCode | string | null | undefined): string {
    switch (code) {
        case "auth":
            return "메일함 연결이 끊겼습니다 — 갱신 토큰을 다시 받아 주세요";
        case "scope":
            return "메일함 읽기 권한이 부족합니다 — gmail.readonly 범위로 토큰을 다시 받아 주세요";
        case "mailbox_mismatch":
            return "메일함 주소가 맞지 않습니다 — REPLY_MAILBOX에는 별칭이 아니라 그 계정의 기본 주소를 넣어 주세요";
        case "rate_limited":
            return "Gmail 사용량 한도에 걸렸습니다";
        case "transient":
            return "Gmail 연결이 잠시 불안정합니다";
        case "config":
            return "회신 읽기 설정이 잘못되었습니다";
        case "db":
            return "DB 연결 오류로 회신을 저장하지 못했습니다";
        case "stale":
            return "6시간 넘게 회신을 읽지 못했습니다";
        case "internal":
            return "회신 읽기 중 예상하지 못한 오류가 났습니다 — 서버 로그 [reply-sync]를 확인해 주세요";
        case "read_blocked":
            return "운영 서버인데 REPLY_PRIVATE_DOMAINS가 비어 메일함을 읽지 않습니다";
        default:
            return code ? `알 수 없는 오류 (${code})` : "";
    }
}

/** 바로 운영 알림을 보낼 오류 (설정 오류). 나머지는 1시간 넘게 이어질 때만 */
export function isImmediateOpsError(code: string): boolean {
    return code === "auth" || code === "scope" || code === "mailbox_mismatch" || code === "read_blocked";
}

/** 운영 알림의 짧은 원인 (할 일이 섞이지 않은 이름) — 첫 줄·회복 글에 쓴다 (RO-5·RO-8) */
export function replyErrorShort(code: string | null | undefined): string {
    switch (code) {
        case "auth":
            return "메일함 연결 끊김 (갱신 토큰 만료·취소)";
        case "scope":
            return "메일함 읽기 권한 부족";
        case "mailbox_mismatch":
            return "메일함 주소가 맞지 않음";
        case "rate_limited":
            return "Gmail 사용량 한도";
        case "transient":
            return "Gmail 연결 불안정";
        case "config":
            return "회신 읽기 설정 오류";
        case "db":
            return "DB 연결 오류";
        case "internal":
            return "예상하지 못한 오류";
        case "read_blocked":
            return "메일함 별칭 도메인 설정(REPLY_PRIVATE_DOMAINS)이 비어 읽지 않음";
        case "stale":
            return "6시간 넘게 읽지 못함";
        default:
            return code ? `알 수 없는 오류 (${code})` : "알 수 없는 오류";
    }
}

/** 원인에 맞는 할 일 (비개발자 대표가 읽는다 — 누구에게 무엇을 부탁할지, RO-5) */
function replyOpsFix(code: string): string {
    if (code === "auth" || code === "scope") {
        return "할 일: 개발 담당에게 \"회신 메일함 갱신 토큰 다시 받기\"를 부탁해 주세요 (설계 문서 DESIGN-RPL 13-4절, 약 10분)";
    }
    if (code === "mailbox_mismatch") {
        return "할 일: 개발 담당에게 환경 변수 `REPLY_MAILBOX`를 메일함 계정의 기본 주소로 고쳐 배포하도록 부탁해 주세요";
    }
    if (code === "read_blocked") {
        return "할 일: 개발 담당에게 환경 변수 `REPLY_PRIVATE_DOMAINS`(메일함 계정의 별칭 도메인, 정말 없으면 none)를 넣어 배포하도록 부탁해 주세요";
    }
    return "할 일: 보통 저절로 풀립니다. 1시간 넘게 이어지면 개발 담당에게 알려 주세요 (서버 로그 [reply-sync])";
}

/** 시험(개발) 서버면 글 앞에 붙일 표시 — 운영·개발이 같은 스페이스를 쓸 때 어느 서버를 고칠지 알게 (RO-10) */
export function replyServerLabel(config: Pick<ReplyConfig, "serverKind" | "baseUrl">): string {
    if (config.serverKind === "production") return "";
    let host = config.baseUrl;
    try {
        host = new URL(config.baseUrl).host;
    } catch {
        // 주소로 읽히지 않으면 그대로
    }
    return `[개발 서버 · ${host}] `;
}

/**
 * 운영 알림 글 — 주소·제목·본문 없음. 원인 → 영향 → 할 일 → 회신 탭 순서 (RO-5).
 * stale이면 원래 원인(code)으로 할 일을 고른다 (RO-2·RC-15). dry_run이면 자동 메일은 원래 멈추지 않는다 (RO-9)
 */
export function buildOpsAlertMessage(
    code: ReplyErrorCode | string,
    lastSuccessAt: Date | null,
    opts: { stale?: boolean; syncMode?: ReplySyncMode; serverLabel?: string; baseUrl?: string } = {}
): string {
    const head = opts.stale
        ? `⚠️ ${opts.serverLabel ?? ""}샌드비 회신 읽기 멈춤: 6시간 넘게 회신을 읽지 못했습니다 — 원인: ${replyErrorShort(code)}`
        : `⚠️ ${opts.serverLabel ?? ""}샌드비 회신 읽기 멈춤: ${replyErrorShort(code)}`;
    const since = lastSuccessAt ? `${formatKstShort(lastSuccessAt)} 뒤로` : "그동안";
    const effect =
        opts.syncMode === "dry_run"
            ? `영향: 시험 모드(dry_run)라 자동 메일 멈춤은 아직 꺼져 있습니다 — ${since} 온 회신의 기록·카드만 늦어집니다`
            : `영향: ${since} 회신한 사람에게도 후속·AI 첫 메일이 나갈 수 있습니다`;
    const lines = [head, effect, replyOpsFix(code)];
    if (opts.baseUrl) lines.push(`<${opts.baseUrl.replace(/\/+$/, "")}/email?tab=replies|회신 탭 보기>`);
    return lines.join("\n");
}

/** 회복 글 — 짧은 원인만 (할 일 문장 없이), 멈춘 동안 온 회신도 이어 읽는다 (RO-8) */
export function buildOpsRecoveredMessage(code: string | null, now: Date, opts: { serverLabel?: string } = {}): string {
    return (
        `✅ ${opts.serverLabel ?? ""}샌드비 회신 읽기가 다시 됩니다 (${formatKstShort(now)})` +
        `${code ? ` — 직전 원인: ${replyErrorShort(code)}` : ""}. 멈춘 동안 온 회신도 이어서 읽고 카드를 보냅니다`
    );
}

/**
 * 운영 알림을 보낼지. 같은 문제는 6시간에 한 번 — 원인이 바뀌면(바로 알릴 원인이면) 기다리지 않는다 (RO-7).
 * 바로 보낼 오류(인증·권한·메일함 다름·읽기 막힘)이거나, 오류가 1시간 넘게 이어졌거나(일시 오류), stale이면.
 * 회복 뒤 1시간 안에 다시 나면 바로 알리지 않고 1시간 넘게 이어질 때만 (오락가락, RO-15)
 */
export function shouldSendOpsAlert(opts: {
    code: string;
    now: Date;
    lastSuccessAt: Date | null;
    firstErrorAt: Date | null;
    opsAlertedAt: Date | null;
    /** 지난 알림의 원인 */
    opsAlertedCode?: string | null;
    /** 마지막 회복 때 */
    recoveredAt?: Date | null;
    stale?: boolean;
}): boolean {
    const immediate = isImmediateOpsError(opts.code) || opts.code === "stale" || opts.stale === true;
    if (opts.opsAlertedAt && opts.now.getTime() - opts.opsAlertedAt.getTime() < OPS_ALERT_INTERVAL_MS) {
        const changed = !!opts.opsAlertedCode && opts.opsAlertedCode !== opts.code;
        return changed && isImmediateOpsError(opts.code);
    }
    const flapping = !!opts.recoveredAt && opts.now.getTime() - opts.recoveredAt.getTime() < OPS_FLAP_WINDOW_MS;
    if (immediate && !flapping) return true;
    const since = flapping ? opts.firstErrorAt : opts.lastSuccessAt ?? opts.firstErrorAt;
    return since !== null && since !== undefined && opts.now.getTime() - since.getTime() > TRANSIENT_ALERT_AFTER_MS;
}

// ============================================
// Gmail 요청 모양 (4-2, 10-2)
// ============================================

const GMAIL_BASE_PATH = "/gmail/v1/users/me";

/** 1단계 요청: 받는 사람·스레드 머리글 7개만, snippet 없이 (R5) */
export function recipientsRequestPath(messageId: string): string {
    const q = new URLSearchParams();
    q.set("format", "metadata");
    for (const h of STAGE1_HEADERS) q.append("metadataHeaders", h);
    q.set("fields", "id,threadId,labelIds,internalDate,sizeEstimate,payload/headers");
    return `${GMAIL_BASE_PATH}/messages/${encodeURIComponent(messageId)}?${q.toString()}`;
}

/** 1.5단계 요청 (시험 서버만): From만 */
export function fromRequestPath(messageId: string): string {
    const q = new URLSearchParams();
    q.set("format", "metadata");
    q.append("metadataHeaders", "From");
    q.set("fields", "id,payload/headers");
    return `${GMAIL_BASE_PATH}/messages/${encodeURIComponent(messageId)}?${q.toString()}`;
}

/** 2단계 요청 (우리 것만): 머리글 전부와 본문 */
export function fullRequestPath(messageId: string): string {
    return `${GMAIL_BASE_PATH}/messages/${encodeURIComponent(messageId)}?format=full`;
}

/** 2단계, 5MB 넘는 메일: 머리글 전부만 */
export function allHeadersRequestPath(messageId: string): string {
    const q = new URLSearchParams();
    q.set("format", "metadata");
    q.set("fields", "id,threadId,labelIds,internalDate,sizeEstimate,payload/mimeType,payload/headers");
    return `${GMAIL_BASE_PATH}/messages/${encodeURIComponent(messageId)}?${q.toString()}`;
}

export function reportPartRequestPath(messageId: string, attachmentId: string): string {
    return `${GMAIL_BASE_PATH}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

const LIST_EXCLUDE = "-in:sent -in:chats -in:drafts";

function epochSeconds(d: Date): number {
    return Math.floor(d.getTime() / 1000);
}

/** history 404일 때 목록으로 이어 읽기 시작 시각: 마지막 성공 1시간 전 (최소 2일 전, 최대 30일 전) */
export function fallbackListAfter(lastSuccessAt: Date | null, now: Date): Date {
    const minAfter = now.getTime() - HISTORY_FALLBACK_MAX_MS;
    const maxAfter = now.getTime() - HISTORY_FALLBACK_MIN_MS;
    const wanted = lastSuccessAt ? lastSuccessAt.getTime() - HOUR_MS : maxAfter;
    return new Date(Math.max(minAfter, Math.min(wanted, maxAfter)));
}

/** history 404일 때 목록 조회 q */
export function fallbackListQuery(lastSuccessAt: Date | null, now: Date): string {
    return `after:${epochSeconds(fallbackListAfter(lastSuccessAt, now))} ${LIST_EXCLUDE}`;
}

/** 처음 거슬러 읽기 q (최근 것부터 나온다) */
export function backfillListQuery(after: Date, before: Date): string {
    return `after:${epochSeconds(after)} before:${epochSeconds(before)} ${LIST_EXCLUDE}`;
}

/**
 * 거슬러 읽기 다음 before: 처리한 가장 이른 메일이 든 초까지 포함 (같은 초의 남은 메일을 놓치지 않게). 경계의 같은 메일은 유일 키가 막는다
 */
export function nextBackfillBefore(earliestInternalDateMs: number): Date {
    return new Date((Math.floor(earliestInternalDateMs / 1000) + 1) * 1000);
}

// ============================================
// 통계
// ============================================

/** 회차 숫자 — 주소·제목 없음 */
export interface ReplyRunCounts {
    listed: number;
    skippedLabel: number;
    notOurs: number;
    notAllowedFrom: number;
    outOfScope: number;
    ours: number;
    bodyFetched: number;
    reportParts: number;
    skippedSelf: number;
    skippedSpam: number;
    stored: number;
    duplicates: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    human: number;
    autoReply: number;
    bounce: number;
    system: number;
    internal: number;
    unknown: number;
    dbErrors: number;
    effectsApplied: number;
    pendingEffectsApplied: number;
    bounceSignals: number;
    gone: number;
}

export function emptyRunCounts(): ReplyRunCounts {
    return {
        listed: 0,
        skippedLabel: 0,
        notOurs: 0,
        notAllowedFrom: 0,
        outOfScope: 0,
        ours: 0,
        bodyFetched: 0,
        reportParts: 0,
        skippedSelf: 0,
        skippedSpam: 0,
        stored: 0,
        duplicates: 0,
        matched: 0,
        unmatched: 0,
        ambiguous: 0,
        human: 0,
        autoReply: 0,
        bounce: 0,
        system: 0,
        internal: 0,
        unknown: 0,
        dbErrors: 0,
        effectsApplied: 0,
        pendingEffectsApplied: 0,
        bounceSignals: 0,
        gone: 0,
    };
}

export function countKind(counts: ReplyRunCounts, kind: ReplyKind): void {
    if (kind === "auto_reply") counts.autoReply++;
    else counts[kind]++;
}

/** 상태 stats: 마지막 회차와 오늘(KST) 누적 */
export function mergeDailyCounts(
    prevStats: Record<string, unknown> | null | undefined,
    run: ReplyRunCounts,
    now: Date
): { date: string; counts: ReplyRunCounts } {
    const date = kstParts(now).date;
    const prevToday = (prevStats?.today ?? null) as { date?: unknown; counts?: unknown } | null;
    const base = emptyRunCounts();
    if (prevToday && prevToday.date === date && prevToday.counts && typeof prevToday.counts === "object") {
        for (const k of Object.keys(base) as Array<keyof ReplyRunCounts>) {
            const v = (prevToday.counts as Record<string, unknown>)[k];
            if (typeof v === "number" && Number.isFinite(v)) base[k] = v;
        }
    }
    for (const k of Object.keys(base) as Array<keyof ReplyRunCounts>) base[k] += run[k];
    return { date, counts: base };
}

/** 로그 한 줄 (주소·제목·발췌 없음) */
export function runSummaryLine(c: ReplyRunCounts): string {
    return (
        `listed=${c.listed} ours=${c.ours} notOurs=${c.notOurs} notAllowedFrom=${c.notAllowedFrom} outOfScope=${c.outOfScope} ` +
        `stored=${c.stored} dup=${c.duplicates} matched=${c.matched} unmatched=${c.unmatched} ambiguous=${c.ambiguous} ` +
        `body=${c.bodyFetched} parts=${c.reportParts} effects=${c.effectsApplied} pendingEffects=${c.pendingEffectsApplied} ` +
        `bounceSignals=${c.bounceSignals} dbErrors=${c.dbErrors}`
    );
}

// ============================================
// 연락 요약 재료 (카드 둘째 줄)
// ============================================

/** 레코드 칸 → contactSummaryOf 입력 (값은 짧은 글자로) */
export function contactFieldsOf(
    defs: ReadonlyArray<{ key: string; label: string; fieldType: string }>,
    data: Record<string, unknown> | null | undefined
): AlertEvidence["fields"] {
    const out: AlertEvidence["fields"] = [];
    const seen = new Set<string>();
    for (const def of defs) {
        if (seen.has(def.key) || def.key.startsWith("_")) continue;
        seen.add(def.key);
        const raw = data?.[def.key];
        if (raw === null || raw === undefined) continue;
        if (typeof raw !== "string" && typeof raw !== "number") continue;
        const value = String(raw).trim();
        if (!value) continue;
        out.push({ label: def.label, value: clipChars(value, 120), key: def.key, fieldType: def.fieldType });
    }
    return out;
}
