import { test } from "node:test";
import assert from "node:assert";
import {
    ALERT_MAX_AGE_MS,
    BODY_SCAN_MAX_CHARS,
    OLD_REPLY_ALERT_ERROR,
    REPORT_PART_MAX_BYTES,
    STAGE1_HEADERS,
    addressVariants,
    backfillListQuery,
    bounceTypeOf,
    buildOpsAlertMessage,
    buildOpsRecoveredMessage,
    refreshReplyCardForSend,
    replyServerLabel,
    buildOurAddressSet,
    buildReplyAlertMessage,
    buildUnmatchedReplyAlertMessage,
    classifyReply,
    contactFieldsOf,
    decodeMimeWords,
    decodePartData,
    extractBodies,
    fallbackListQuery,
    feedbackRecipientOf,
    fromRequestPath,
    hasUnsubscribeHint,
    htmlToText,
    isConnectionError,
    isDataError,
    isSkippedLabel,
    makeExcerpt,
    maskEmail,
    newSenderDomainNeedsAdmin,
    mergeDailyCounts,
    emptyRunCounts,
    nextBackfillBefore,
    normalizeReplyAddress,
    normalizeSubject,
    originalMessageIdOf,
    parseAddressList,
    parseDeliveryStatus,
    pgErrorOf,
    pickFallbackLog,
    pickThreadLog,
    planReplyEffects,
    processErrorText,
    recipientOwnership,
    recipientsRequestPath,
    replyAlertStatus,
    replyAlertTarget,
    replyErrorText,
    replyTextOf,
    reportPartsToFetch,
    requestIdCandidatesOf,
    resolveReplyConfig,
    ruleOf,
    shouldSendOpsAlert,
    stepLabel,
    stopCountsText,
    stripHtmlQuote,
    stripOurFooter,
    stripQuoted,
    subjectsMatch,
    threadRequestIdCandidates,
    type AddressCandidate,
    type FallbackLogCandidate,
    type GmailHeader,
    type GmailPart,
    type ReplyAlertInput,
} from "./email-reply-rules";
import { classifyDsn } from "./email-status-sync-rules";

// 가짜 값만 쓴다 (실제 메일함·토큰이 아니다)
const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";
const NOW = new Date("2026-10-12T10:42:00+09:00"); // 월요일 근무시간

const H = (pairs: Array<[string, string]>): GmailHeader[] => pairs.map(([name, value]) => ({ name, value }));
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// ============================================
// 설정 (3절, M1)
// ============================================

const PROD_ENV = {
    NEXT_PUBLIC_BASE_URL: "https://sendb.kr",
    REPLY_GOOGLE_CLIENT_ID: "test-client",
    REPLY_GOOGLE_CLIENT_SECRET: "test-secret",
    REPLY_GOOGLE_REFRESH_TOKEN: "test-refresh",
    REPLY_PRIVATE_DOMAINS: "alias-ceo.test",
};

test("설정: 모드 값이 없거나 오타면 둘 다 dry_run (R1)", () => {
    const c = resolveReplyConfig({ ...PROD_ENV, REPLY_SYNC_MODE: "onn", REPLY_ALERT_MODE: "" });
    assert.equal(c.syncMode, "dry_run");
    assert.equal(c.alertMode, "dry_run");
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_SYNC_MODE: " OFF " }).syncMode, "off");
});

test("설정: 비밀값 셋 중 하나라도 없으면 credentials null (R2)", () => {
    assert.ok(resolveReplyConfig(PROD_ENV).credentials);
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_GOOGLE_REFRESH_TOKEN: " " }).credentials, null);
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_GOOGLE_CLIENT_SECRET: undefined }).credentials, null);
});

test("설정: 메일함 기본값·소문자, 메일함 도메인은 늘 메일함 쪽 도메인", () => {
    const c = resolveReplyConfig({ ...PROD_ENV, REPLY_PRIVATE_DOMAINS: "Alias.test, @other.test, 잘못" });
    assert.equal(c.mailbox, "ceo@matchesplan.com");
    assert.deepEqual(c.privateDomains, ["matchesplan.com", "alias.test", "other.test"]);
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_MAILBOX: " Reply@Matchesplan.com " }).mailbox, "reply@matchesplan.com");
});

test("설정: 운영 서버에서 REPLY_PRIVATE_DOMAINS가 비면 메일함을 읽지 않는다 — none은 받는다 (RH-SEC-2)", () => {
    const missing = resolveReplyConfig({ ...PROD_ENV, REPLY_SYNC_MODE: "on", REPLY_PRIVATE_DOMAINS: " " });
    assert.equal(missing.readBlockedReason, "private_domains_missing");
    // 모드는 그대로 — 이미 저장된 회신의 보내기 직전 막기는 계속 돈다
    assert.equal(missing.syncMode, "on");
    assert.ok(missing.warnings.some((w) => w.code === "private_domains_missing"));
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_PRIVATE_DOMAINS: undefined }).readBlockedReason, "private_domains_missing");
    // 잘못된 값만 있어도 비어 있는 것과 같다
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_PRIVATE_DOMAINS: "잘못" }).readBlockedReason, "private_domains_missing");
    const none = resolveReplyConfig({ ...PROD_ENV, REPLY_PRIVATE_DOMAINS: "None" });
    assert.equal(none.readBlockedReason, null);
    assert.deepEqual(none.privateDomains, ["matchesplan.com"]);
    assert.equal(resolveReplyConfig(PROD_ENV).readBlockedReason, null);
    // 시험 서버는 직원 주소(REPLY_ALLOWED_FROM) 거름이 따로 있다 — 막지 않는다
    assert.equal(resolveReplyConfig({ ...PROD_ENV, NEXT_PUBLIC_BASE_URL: "http://localhost:3100", REPLY_PRIVATE_DOMAINS: "" }).readBlockedReason, null);
});

test("새 발신 도메인: 조직이 처음 쓰는 도메인이면 관리자만, 이미 쓰는 도메인·같은 도메인 안 변경은 누구나 (RH-SEC-2)", () => {
    const known = ["cs@send-a.test", "hello@send-b.test", null];
    assert.match(newSenderDomainNeedsAdmin({ nextFromEmail: "hr@designer-hire.test", currentFromEmail: null, knownEmails: known }) ?? "", /관리자/);
    assert.equal(newSenderDomainNeedsAdmin({ nextFromEmail: "cs2@Send-A.test", currentFromEmail: null, knownEmails: known }), null);
    assert.equal(newSenderDomainNeedsAdmin({ nextFromEmail: "new@own.test", currentFromEmail: "old@own.test", knownEmails: known }), null);
    assert.match(newSenderDomainNeedsAdmin({ nextFromEmail: "hr@alias.test", currentFromEmail: "cs@send-a.test", knownEmails: known }) ?? "", /관리자/);
    assert.equal(newSenderDomainNeedsAdmin({ nextFromEmail: undefined, currentFromEmail: "cs@send-a.test", knownEmails: known }), null);
    // 첫 프로필: 아는 주소가 없으면 관리자
    assert.match(newSenderDomainNeedsAdmin({ nextFromEmail: "cs@first.test", currentFromEmail: null, knownEmails: [] }) ?? "", /관리자/);
});

test("설정: 운영 origin이면 운영 서버, 거슬러 읽기 기본 14·최대 60", () => {
    const c = resolveReplyConfig({ ...PROD_ENV, REPLY_SYNC_MODE: "on", REPLY_ALERT_MODE: "live" });
    assert.equal(c.serverKind, "production");
    assert.equal(c.syncMode, "on");
    assert.equal(c.alertMode, "live");
    assert.equal(c.backfillDays, 14);
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_BACKFILL_DAYS: "90" }).backfillDays, 60);
    assert.deepEqual(c.warnings, []);
});

test("설정: 시험 서버는 on·live를 시험 주소·직원 주소가 둘 다 있을 때만 (M1, R58)", () => {
    const dev = { ...PROD_ENV, NEXT_PUBLIC_BASE_URL: "https://port-next-sendb-dev.example.test", REPLY_SYNC_MODE: "on", REPLY_ALERT_MODE: "live" };
    const a = resolveReplyConfig(dev);
    assert.equal(a.serverKind, "test");
    assert.equal(a.syncMode, "dry_run");
    assert.equal(a.alertMode, "dry_run");
    assert.ok(a.warnings.some((w) => w.code === "test_server_on_blocked"));
    assert.ok(a.warnings.some((w) => w.code === "test_server_no_allowed_from"));

    const b = resolveReplyConfig({ ...dev, REPLY_ALLOWED_FROM: "staff@co.test" });
    assert.equal(b.syncMode, "dry_run");
    assert.ok(b.warnings.some((w) => w.code === "test_server_allowed_from"));

    const c = resolveReplyConfig({ ...dev, REPLY_ALLOWED_FROM: "staff@co.test", REPLY_SENDER_EMAILS: "cs@test-only.test" });
    assert.equal(c.syncMode, "on");
    assert.equal(c.alertMode, "live");
    assert.deepEqual(c.allowedFrom, ["staff@co.test"]);
    assert.deepEqual(c.senderEmails, ["cs@test-only.test"]);
});

test("설정: 시험 서버 거슬러 읽기는 최대 1일 (기본 0)", () => {
    const dev = { ...PROD_ENV, NEXT_PUBLIC_BASE_URL: "http://localhost:3100" };
    assert.equal(resolveReplyConfig(dev).backfillDays, 0);
    const c = resolveReplyConfig({ ...dev, REPLY_BACKFILL_DAYS: "14" });
    assert.equal(c.backfillDays, 1);
    assert.ok(c.warnings.some((w) => w.code === "backfill_capped"));
});

test("설정: REPLY_TEST_ASSUME_PRODUCTION은 DB가 이 PC일 때만 받는다", () => {
    const base = { ...PROD_ENV, NEXT_PUBLIC_BASE_URL: "http://localhost:3100", REPLY_TEST_ASSUME_PRODUCTION: "1" };
    assert.equal(resolveReplyConfig({ ...base, DATABASE_URL: "postgres://u:p@127.0.0.1:54329/salesflow_test" }).serverKind, "production");
    assert.equal(resolveReplyConfig({ ...base, DATABASE_URL: "postgres://u:p@db.cloudtype.example:5432/x" }).serverKind, "test");
});

test("설정: 운영 알림 받는 곳 순서 REPLY_OPS → SEND_HEALTH → DEEP_ALERT (M7, R61)", () => {
    const hook = (s: string) => `https://chat.googleapis.com/v1/spaces/${s}/messages?key=k&token=t`;
    assert.equal(resolveReplyConfig({ ...PROD_ENV, DEEP_ALERT_WEBHOOK_URL: hook("D") }).opsWebhook?.source, "DEEP_ALERT_WEBHOOK_URL");
    assert.equal(
        resolveReplyConfig({ ...PROD_ENV, DEEP_ALERT_WEBHOOK_URL: hook("D"), SEND_HEALTH_WEBHOOK_URL: hook("S") }).opsWebhook?.source,
        "SEND_HEALTH_WEBHOOK_URL"
    );
    assert.equal(
        resolveReplyConfig({ ...PROD_ENV, SEND_HEALTH_WEBHOOK_URL: hook("S"), REPLY_OPS_WEBHOOK_URL: hook("R") }).opsWebhook?.url,
        hook("R")
    );
    assert.equal(resolveReplyConfig({ ...PROD_ENV, REPLY_OPS_WEBHOOK_URL: "http://plain.test" }).opsWebhook, null);
});

test("설정: 워크스페이스 비면 DEEP_ALERT_WORKSPACE_IDS, 웹훅은 워크스페이스별 → 공통", () => {
    const c = resolveReplyConfig({
        ...PROD_ENV,
        DEEP_ALERT_WORKSPACE_IDS: "8, 9,x,9",
        DEEP_ALERT_WEBHOOK_URL_8: "https://chat.googleapis.com/v1/spaces/A8/messages",
        DEEP_ALERT_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/ALL/messages",
    });
    assert.deepEqual(c.workspaceIds, [8, 9]);
    assert.match(c.webhookByWorkspace[8], /A8/);
    assert.match(c.webhookByWorkspace[9], /ALL/);
    assert.deepEqual(resolveReplyConfig({ ...PROD_ENV, REPLY_WORKSPACE_IDS: "14", DEEP_ALERT_WORKSPACE_IDS: "8" }).workspaceIds, [14]);
});

// ============================================
// 주소
// ============================================

test("주소 정규화: 공백 문자·대소문자·+태그 (m9)", () => {
    assert.equal(normalizeReplyAddress(" CS+campaign@Dh-Mail1.test "), "cs@dh-mail1.test");
    assert.equal(normalizeReplyAddress("<kim@co.test>"), "kim@co.test");
    assert.equal(normalizeReplyAddress("+x@co.test"), "+x@co.test");
    assert.deepEqual(addressVariants("Kim+X@Co.test"), ["kim+x@co.test", "kim@co.test"]);
    assert.deepEqual(addressVariants("kim@co.test"), ["kim@co.test"]);
});

test("주소 가리기: a***@도메인", () => {
    assert.equal(maskEmail("cs@matchesplan.com"), "c***@matchesplan.com");
    assert.equal(maskEmail("한글@도메인.test"), "한***@도메인.test");
});

test("RFC 2047: UTF-8 B·EUC-KR Q·붙은 단어 사이 공백", () => {
    assert.equal(decodeMimeWords(`=?UTF-8?B?${Buffer.from("김시험").toString("base64")}?=`), "김시험");
    // EUC-KR "가" = B0 A1
    assert.equal(decodeMimeWords("=?EUC-KR?Q?=B0=A1?= =?EUC-KR?Q?=B0=A1?="), "가가");
    assert.equal(decodeMimeWords("=?ks_c_5601-1987?B?sKE=?="), "가");
    assert.equal(decodeMimeWords("Re: =?UTF-8?Q?=EC=95=88=EB=85=95?= 하세요"), "Re: 안녕 하세요");
    assert.equal(decodeMimeWords("평범한 제목"), "평범한 제목");
});

test("주소 목록: 따옴표 안 쉼표·인코딩 이름·그룹·꺾쇠 없는 주소", () => {
    const list = parseAddressList(
        `"Kim, Siheom" <Kim@Co.test>, =?UTF-8?B?${Buffer.from("이시험").toString("base64")}?= <lee@co.test>, bare@co.test, undisclosed-recipients:;`
    );
    assert.deepEqual(list, [
        { name: "Kim, Siheom", address: "kim@co.test" },
        { name: "이시험", address: "lee@co.test" },
        { name: "", address: "bare@co.test" },
    ]);
    assert.deepEqual(parseAddressList("팀: a@x.test, b@x.test;"), [
        { name: "", address: "a@x.test" },
        { name: "", address: "b@x.test" },
    ]);
});

// ============================================
// 개인정보 거르기 (4-1·4-2, B1)
// ============================================

function ourSet(candidates: AddressCandidate[], extra: Partial<Parameters<typeof buildOurAddressSet>[0]> = {}) {
    return buildOurAddressSet({
        candidates,
        mailbox: "ceo@matchesplan.test",
        profileEmail: "ceo@matchesplan.test",
        privateDomains: ["matchesplan.test", "alias-ceo.test"],
        sharedDomainAddresses: [],
        senderEmails: null,
        ...extra,
    });
}

test("주소 모음: 메일함 주소·메일함 도메인·별칭 도메인 주소는 프로필·설정에 있어도 뺀다 (R50, RS7b)", () => {
    const set = ourSet([
        { email: "hello1@dh-mail1.test", orgId: ORG_A, source: "profile" },
        { email: "CEO@matchesplan.test", orgId: ORG_A, source: "profile" },
        { email: "hr@matchesplan.test", orgId: ORG_A, source: "config" },
        { email: "hr@alias-ceo.test", orgId: ORG_A, source: "profile" },
    ]);
    assert.deepEqual([...set.addresses.keys()], ["hello1@dh-mail1.test"]);
    assert.deepEqual([...set.domains.keys()], ["dh-mail1.test"]);
    assert.deepEqual(set.excludedMasked, ["c***@matchesplan.test", "h***@alias-ceo.test", "h***@matchesplan.test"]);
});

test("주소 모음: REPLY_SHARED_DOMAIN_ADDRESSES 주소만 남고, 그 도메인은 도메인 모음에 넣지 않는다 (RS7c)", () => {
    const set = ourSet(
        [
            { email: "cs@alias-ceo.test", orgId: ORG_A, source: "profile" },
            { email: "info@alias-ceo.test", orgId: ORG_A, source: "profile" },
        ],
        { sharedDomainAddresses: ["cs@alias-ceo.test"] }
    );
    assert.deepEqual([...set.addresses.keys()], ["cs@alias-ceo.test"]);
    assert.equal(set.domains.size, 0);
    assert.deepEqual(set.excludedMasked, ["i***@alias-ceo.test"]);
});

test("주소 모음: 같은 주소가 두 조직에, REPLY_SENDER_EMAILS가 있으면 그 주소만 (R10)", () => {
    const candidates: AddressCandidate[] = [
        { email: "shared@co-mail.test", orgId: ORG_A, source: "profile" },
        { email: "shared@co-mail.test", orgId: ORG_B, source: "profile" },
        { email: "other@co-mail.test", orgId: ORG_A, source: "send_log" },
    ];
    assert.deepEqual(ourSet(candidates).addresses.get("shared@co-mail.test"), [ORG_A, ORG_B]);
    const only = ourSet(candidates, { senderEmails: ["other@co-mail.test"] });
    assert.deepEqual([...only.addresses.keys()], ["other@co-mail.test"]);
});

test("판정: Delivered-To·X-Original-To의 메일함 주소로는 아무것도 우리 것이 아니다 (R7, B1)", () => {
    const set = ourSet([{ email: "hello1@dh-mail1.test", orgId: ORG_A, source: "profile" }]);
    const own = recipientOwnership(
        H([
            ["To", "인사팀 <hr@matchesplan.test>"],
            ["Delivered-To", "ceo@matchesplan.test"],
            ["X-Original-To", "ceo@matchesplan.test"],
        ]),
        set
    );
    assert.deepEqual(own, { kind: "none" });
});

test("판정: To가 우리 주소(+태그)면 주소 일치, 도메인만 같으면 도메인 후보, 주소 일치가 먼저", () => {
    const set = ourSet([{ email: "hello1@dh-mail1.test", orgId: ORG_A, source: "profile" }]);
    assert.deepEqual(recipientOwnership(H([["To", "Hello1+x@DH-mail1.test"]]), set), {
        kind: "address",
        address: "hello1@dh-mail1.test",
        orgIds: [ORG_A],
    });
    assert.deepEqual(recipientOwnership(H([["To", "info@dh-mail1.test"]]), set), {
        kind: "domain",
        address: "info@dh-mail1.test",
        domain: "dh-mail1.test",
        orgIds: [ORG_A],
    });
    const both = recipientOwnership(H([["To", "info@dh-mail1.test"], ["Cc", "hello1@dh-mail1.test"]]), set);
    assert.equal(both.kind, "address");
    // 보조 도메인 라우팅: To는 cs@<도메인> 그대로, Delivered-To는 메일함
    const routed = recipientOwnership(H([["To", "x@else.test"], ["X-Gm-Original-To", "hello1@dh-mail1.test"], ["Delivered-To", "ceo@matchesplan.test"]]), set);
    assert.equal(routed.kind, "address");
});

test("판정: 다른 조직 주소는 그 조직 것으로 나온다 — 부른 쪽이 허용 조직만 모은다 (R11)", () => {
    const set = ourSet([{ email: "hello@other-company.test", orgId: ORG_B, source: "profile" }]);
    const own = recipientOwnership(H([["To", "hello@other-company.test"]]), set);
    assert.equal(own.kind, "address");
    assert.deepEqual(own.kind === "address" ? own.orgIds : [], [ORG_B]);
});

test("1단계 요청: format=metadata, 받는 사람·스레드 머리글 7개만, fields에 snippet 없음 (R5)", () => {
    const url = new URL(`https://gmail.googleapis.com${recipientsRequestPath("abc123")}`);
    assert.equal(url.searchParams.get("format"), "metadata");
    assert.deepEqual(url.searchParams.getAll("metadataHeaders"), [...STAGE1_HEADERS]);
    assert.equal(STAGE1_HEADERS.length, 7);
    assert.ok(!url.searchParams.getAll("metadataHeaders").some((h) => /^(from|subject)$/i.test(h)));
    assert.ok(!(url.searchParams.get("fields") ?? "").includes("snippet"));
    const from = new URL(`https://gmail.googleapis.com${fromRequestPath("abc123")}`);
    assert.deepEqual(from.searchParams.getAll("metadataHeaders"), ["From"]);
    assert.ok(!(from.searchParams.get("fields") ?? "").includes("snippet"));
});

test("라벨: SENT·DRAFT·CHAT은 버린다 (R8)", () => {
    assert.equal(isSkippedLabel(["INBOX"]), false);
    assert.equal(isSkippedLabel(["SENT"]), true);
    assert.equal(isSkippedLabel(["DRAFT", "INBOX"]), true);
    assert.equal(isSkippedLabel(["CHAT"]), true);
});

// ============================================
// 짝짓기 (6절)
// ============================================

test("스레드 후보: NHN 요청 번호 앞 22자, mock 요청 번호는 로컬 부분 그대로 (R17)", () => {
    assert.deepEqual(requestIdCandidatesOf("20210806120100sA3CcWU2@tcmmsapp-92a901"), ["20210806120100sA3CcWU2"]);
    assert.deepEqual(requestIdCandidatesOf("20210806120100sA3CcWU2.abc@host"), ["20210806120100sA3CcWU2.abc", "20210806120100sA3CcWU2"]);
    assert.deepEqual(requestIdCandidatesOf("mock-1760000000000-3@mock-nhn"), ["mock-1760000000000-3"]);
    assert.deepEqual(
        threadRequestIdCandidates(["<b@h>"], ["<root@h> <a@h>", "<b@h>"]),
        ["b", "a", "root"]
    );
});

test("스레드 짝: 다른 조직 기록이면 이어 붙이지 않는다 (ambiguous)", () => {
    const logs = [
        { id: 1, requestId: "r1", orgId: ORG_B },
        { id: 2, requestId: "r2", orgId: ORG_A },
    ];
    assert.deepEqual(pickThreadLog(["r2"], logs, [ORG_A]), { status: "matched", log: logs[1], requestId: "r2" });
    assert.deepEqual(pickThreadLog(["r1", "r2"], logs, [ORG_A]), { status: "ambiguous" });
    assert.deepEqual(pickThreadLog(["zz"], logs, [ORG_A]), { status: "none" });
});

test("제목 맞추기: Re·회신·[외부]·(광고) 앞머리를 되풀이해 뗀다", () => {
    assert.equal(normalizeSubject("RE: Fwd: [외부] (광고)  회계  자동화 안내"), "회계 자동화 안내");
    assert.equal(normalizeSubject("회신: 답장: Re[2]: 안내"), "안내");
    assert.ok(subjectsMatch("Re: (광고) 회계 안내", "(광고) 회계 안내"));
    assert.ok(!subjectsMatch("", ""));
});

const DAY = 24 * 60 * 60 * 1000;
function fb(over: Partial<FallbackLogCandidate> & { id: number }): FallbackLogCandidate {
    return {
        orgId: ORG_A,
        workspaceId: 8,
        recipientEmail: "kim@co.test",
        senderEmail: "no-reply@designer-hire.test",
        profileFromEmail: null,
        subject: "(광고) 회계 안내",
        sentAt: new Date(NOW.getTime() - 3 * DAY),
        ...over,
    };
}
const FB_BASE = { from: "Kim@Co.test", toAddress: "no-reply@designer-hire.test", orgIds: [ORG_A], receivedAt: NOW };

test("대체 짝: 한 워크스페이스면 제목이 같은 가장 최근, 없으면 가장 최근 (R18)", () => {
    const logs = [fb({ id: 1, sentAt: new Date(NOW.getTime() - 5 * DAY) }), fb({ id: 2, subject: "다른 제목", sentAt: new Date(NOW.getTime() - 1 * DAY) })];
    const a = pickFallbackLog({ ...FB_BASE, logs, subject: "RE: (광고) 회계 안내" });
    assert.equal(a.status === "matched" && a.log.id, 1);
    assert.equal(a.status === "matched" && a.method, "fallback_subject");
    const b = pickFallbackLog({ ...FB_BASE, logs, subject: "문의" });
    assert.equal(b.status === "matched" && b.log.id, 2);
    assert.equal(b.status === "matched" && b.method, "fallback_latest");
});

test("대체 짝: 61일 전 발송만 맞으면 unmatched, 받은 주소가 보낸 주소와 달라도 못 이음 (R19)", () => {
    assert.deepEqual(pickFallbackLog({ ...FB_BASE, logs: [fb({ id: 1, sentAt: new Date(NOW.getTime() - 61 * DAY) })], subject: null }), {
        status: "unmatched",
    });
    assert.deepEqual(pickFallbackLog({ ...FB_BASE, logs: [fb({ id: 1, senderEmail: "hello1@dh-mail1.test" })], subject: null }), {
        status: "unmatched",
    });
});

test("대체 짝: sender_email이 없으면 프로필 지금 주소, 둘 다 없으면 from_only (R22)", () => {
    const viaProfile = pickFallbackLog({ ...FB_BASE, logs: [fb({ id: 1, senderEmail: null, profileFromEmail: "No-Reply@designer-hire.test" })], subject: null });
    assert.equal(viaProfile.status === "matched" && viaProfile.method, "fallback_latest");
    const fromOnly = pickFallbackLog({ ...FB_BASE, logs: [fb({ id: 1, senderEmail: null, profileFromEmail: null })], subject: null });
    assert.equal(fromOnly.status === "matched" && fromOnly.method, "fallback_from_only");
});

test("대체 짝: 여러 사업에 걸치면 제목이 한 사업에만 맞을 때만 잇고 아니면 애매함 (M4, RS16, R52)", () => {
    const logs = [
        fb({ id: 1, workspaceId: 8, subject: "A 사업 안내", sentAt: new Date(NOW.getTime() - 7 * DAY) }),
        fb({ id: 2, workspaceId: 9, subject: "B 사업 안내", sentAt: new Date(NOW.getTime() - 2 * DAY) }),
    ];
    assert.deepEqual(pickFallbackLog({ ...FB_BASE, logs, subject: "Re: 문의드립니다" }), { status: "ambiguous", method: "fallback_multi_ws" });
    const hit = pickFallbackLog({ ...FB_BASE, logs, subject: "Re: A 사업 안내" });
    assert.equal(hit.status === "matched" && hit.log.id, 1);
    assert.equal(hit.status === "matched" && hit.method, "fallback_subject");
});

test("대체 짝: 허용 조직 둘 다 맞으면 애매함, 다른 조직 기록은 보지 않는다 (R20)", () => {
    const logs = [fb({ id: 1, orgId: ORG_A }), fb({ id: 2, orgId: ORG_B })];
    assert.deepEqual(pickFallbackLog({ ...FB_BASE, orgIds: [ORG_A, ORG_B], logs, subject: null }), {
        status: "ambiguous",
        method: "fallback_multi_org",
    });
    const onlyA = pickFallbackLog({ ...FB_BASE, orgIds: [ORG_A], logs, subject: null });
    assert.equal(onlyA.status === "matched" && onlyA.log.id, 1);
});

test("규칙·단계: AI → 템플릿 → manual, 단계 글자 (R47)", () => {
    assert.deepEqual(ruleOf({ autoPersonalizedLinkId: 12, templateLinkId: 5 }), { kind: "ai", id: 12 });
    assert.deepEqual(ruleOf({ autoPersonalizedLinkId: null, templateLinkId: 5 }), { kind: "template", id: 5 });
    assert.deepEqual(ruleOf({ autoPersonalizedLinkId: null, templateLinkId: null }), { kind: "manual", id: null });
    assert.equal(stepLabel(0, null, null), "첫 메일");
    assert.equal(stepLabel(1, new Date(NOW.getTime() - 3.4 * DAY), NOW), "1번째 후속 (첫 메일 +3일)");
});

// ============================================
// 분류 (5절, M5·m6·m7)
// ============================================

const CTX = { orgUserEmails: new Set(["admin@sendb.test"]), mailboxDomains: new Set(["matchesplan.test", "alias-ceo.test"]) };
const cls = (pairs: Array<[string, string]>, from: string, subject = "") =>
    classifyReply({ headers: H(pairs), from, subject }, CTX).kind;

test("분류: delivery-status 보고·MAILER-DAEMON·Return-Path <> + 반송 제목 → bounce (R13·R14)", () => {
    assert.equal(cls([["Content-Type", 'multipart/report; report-type="delivery-status"; boundary=x']], "x@relay.test"), "bounce");
    assert.equal(cls([], "MAILER-DAEMON@googlemail.com", "Delivery Status Notification (Failure)"), "bounce");
    assert.equal(cls([], "postmaster@naver.com", "메일 발송 실패"), "bounce");
    assert.equal(cls([["Return-Path", "<>"]], "notice@mail.test", "Undeliverable: 안내"), "bounce");
});

test("분류: 제목의 반송 말만으로는 반송이 아니다 — 사람 회신 (M5, RS17, R53)", () => {
    assert.equal(cls([], "kim@co.test", "Re: 제품 반송 문의"), "human");
    assert.equal(cls([], "kim@co.test", "Re: 안내"), "human");
});

test("분류: delivery-status가 아닌 report는 system (m7, R57)", () => {
    assert.equal(cls([["Content-Type", "multipart/report; report-type=disposition-notification"]], "kim@co.test"), "system");
    assert.equal(cls([["Content-Type", "multipart/report; report-type=feedback-report"]], "fbl@isp.test"), "system");
});

test("분류: 조직 사용자·메일함 쪽 도메인 주소는 internal (m6, R56)", () => {
    assert.equal(cls([], "Admin@sendb.test", "Re: 안내"), "internal");
    assert.equal(cls([], "staff@alias-ceo.test", "Re: 안내"), "internal");
});

test("분류: 자동 머리글·자동응답 제목 → auto_reply, Auto-Submitted: no는 사람 (R12)", () => {
    assert.equal(cls([["Auto-Submitted", "auto-replied"]], "kim@co.test", "자동 회신: 안내"), "auto_reply");
    assert.equal(cls([["X-Autoreply", "yes"]], "kim@co.test"), "auto_reply");
    assert.equal(cls([["Precedence", "bulk"]], "kim@co.test"), "auto_reply");
    assert.equal(cls([["Return-Path", "<>"]], "kim@co.test", "안내"), "auto_reply");
    assert.equal(cls([], "kim@co.test", "부재중: 안내"), "auto_reply");
    assert.equal(cls([], "kim@co.test", "Out of Office: 안내"), "auto_reply");
    assert.equal(cls([["Auto-Submitted", "no"]], "kim@co.test", "Re: 안내"), "human");
});

test("분류: 본문 '출장 중이라 복귀 후'는 분류에 쓰지 않는다 — 머리글·제목이 없으면 human (RS18)", () => {
    // classifyReply는 본문을 받지 않는다
    assert.equal(cls([], "kim@co.test", "Re: (광고) 회계 안내"), "human");
});

// ============================================
// 반송 안내 (5절)
// ============================================

const GMAIL_DSN = [
    "Reporting-MTA: dns; googlemail.com",
    "Arrival-Date: Mon, 12 Oct 2026 01:00:00 -0700 (PDT)",
    "",
    "Final-Recipient: rfc822; NoSuch@Example.test",
    "Original-Recipient: rfc822;nosuch@example.test",
    "Action: failed",
    "Status: 5.1.1",
    "Remote-MTA: dns; mx.example.test. (1.2.3.4, the server for the domain example.test.)",
    "Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does",
    "    not exist.",
    "",
    "Final-Recipient: rfc822; slow@example.test",
    "Action: delayed",
    "Status: 4.4.7",
    "",
].join("\r\n");

test("DSN 풀기: 수신자 묶음마다 Final/Original/Action/Status/Diagnostic (접힌 줄 포함)", () => {
    const r = parseDeliveryStatus(GMAIL_DSN);
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], {
        finalRecipient: "nosuch@example.test",
        originalRecipient: "nosuch@example.test",
        action: "failed",
        status: "5.1.1",
        diagnostic: "smtp; 550-5.1.1 The email account that you tried to reach does not exist.",
    });
    assert.equal(r[1].action, "delayed");
    assert.equal(r[1].status, "4.4.7");
    assert.deepEqual(parseDeliveryStatus("Final-Recipient: rfc822; a@b.test\nAction: failed\nDiagnostic-Code: smtp; 550 5.2.1 full"), [
        { finalRecipient: "a@b.test", originalRecipient: null, action: "failed", status: "5.2.1", diagnostic: "smtp; 550 5.2.1 full" },
    ]);
    assert.deepEqual(parseDeliveryStatus(""), []);
});

test("DSN 등급: SND classifyDsn 하나 — failed+5 hard, failed+4 expired, delayed soft, 없음 unknown (R13, B2)", () => {
    assert.equal(classifyDsn("failed", "5.1.1"), "hard");
    assert.equal(classifyDsn("failed", "4.4.7"), "expired");
    assert.equal(classifyDsn("delayed", "4.4.7"), "soft");
    assert.equal(classifyDsn(null, "5.1.1"), "hard");
    assert.equal(classifyDsn(null, "4.2.2"), "soft");
    assert.equal(classifyDsn("delivered", "2.0.0"), "unknown");
    assert.equal(classifyDsn(null, null), "unknown");
    assert.equal(bounceTypeOf(parseDeliveryStatus(GMAIL_DSN)), "hard");
    assert.equal(bounceTypeOf([]), "unknown");
});

test("원본 머리글: Message-ID만 읽는다 (본문 무시)", () => {
    assert.equal(
        originalMessageIdOf("From: a@b\r\nMessage-ID:\r\n <mock-1-2@mock-nhn>\r\nSubject: x\r\n\r\nMessage-ID: <body@x>"),
        "mock-1-2@mock-nhn"
    );
    assert.equal(originalMessageIdOf("Subject: 없음"), null);
    assert.equal(feedbackRecipientOf("Feedback-Type: abuse\nOriginal-Rcpt-To: <Kim@Co.test>\n"), "kim@co.test");
});

// ============================================
// MIME 부분 (M9)
// ============================================

function reportMessage(asAttachment: boolean, size = 2048): GmailPart {
    const dsn = b64(GMAIL_DSN);
    const headers = b64("Message-ID: <mock-9-9@mock-nhn>\r\nSubject: (광고) 안내\r\n");
    const part = (partId: string, mimeType: string, data: string): GmailPart =>
        asAttachment ? { partId, mimeType, filename: "", body: { attachmentId: `att-${partId}`, size } } : { partId, mimeType, body: { data, size } };
    return {
        mimeType: "multipart/report",
        headers: H([["Content-Type", "multipart/report; report-type=delivery-status; boundary=b"]]),
        parts: [
            { partId: "0", mimeType: "text/plain", body: { data: b64("배달하지 못했습니다"), size: 30 } },
            part("1", "message/delivery-status", dsn),
            part("2", "text/rfc822-headers", headers),
            { partId: "3", mimeType: "image/png", filename: "logo.png", body: { attachmentId: "att-img", size: 1000 } },
        ],
    };
}

test("보고 부분: 반송 메일의 4가지 형식·64KB 이하 첨부 부분만 받는다 (R51)", () => {
    const refs = reportPartsToFetch(reportMessage(true), "mailer-daemon@googlemail.com");
    assert.deepEqual(refs.map((r) => r.attachmentId), ["att-1", "att-2"]);
    assert.deepEqual(reportPartsToFetch(reportMessage(false), "mailer-daemon@googlemail.com"), []);
    assert.deepEqual(reportPartsToFetch(reportMessage(true, REPORT_PART_MAX_BYTES + 1), "mailer-daemon@googlemail.com"), []);
    // 보고 메일이 아니면 어떤 첨부도 받지 않는다
    const human: GmailPart = { mimeType: "multipart/mixed", parts: [{ partId: "1", mimeType: "message/rfc822", body: { attachmentId: "a", size: 10 } }] };
    assert.deepEqual(reportPartsToFetch(human, "kim@co.test"), []);
});

test("본문 고르기: 첨부로 받은 보고 부분과 원본 머리글을 쓴다, 원본 메일 본문은 읽지 않는다", () => {
    const fetched = new Map([
        ["att-1", b64(GMAIL_DSN)],
        ["att-2", b64("Message-ID: <mock-9-9@mock-nhn>\r\n\r\n본문")],
    ]);
    const bodies = extractBodies(reportMessage(true), fetched);
    assert.equal(parseDeliveryStatus(bodies.deliveryStatus).length, 2);
    assert.equal(originalMessageIdOf(bodies.originalHeaders), "mock-9-9@mock-nhn");
    assert.ok(!(bodies.originalHeaders ?? "").includes("본문"));
    assert.equal(bodies.text, "배달하지 못했습니다");

    const nested: GmailPart = {
        mimeType: "multipart/report",
        parts: [
            { partId: "1", mimeType: "message/rfc822", parts: [{ partId: "1.0", mimeType: "text/plain", headers: H([["Message-ID", "<orig@h>"]]), body: { data: b64("우리 원래 메일 본문") } }] },
        ],
    };
    const nb = extractBodies(nested);
    assert.equal(originalMessageIdOf(nb.originalHeaders), "orig@h");
    assert.equal(nb.text, null);
});

test("charset: EUC-KR·ks_c_5601-1987 본문이 깨지지 않는다 (R16)", () => {
    const eucKr = Buffer.from([0xb0, 0xa1, 0xb3, 0xaa]).toString("base64url"); // "가나"
    assert.equal(decodePartData(eucKr, "ks_c_5601-1987"), "가나");
    const part: GmailPart = {
        mimeType: "text/plain",
        headers: H([["Content-Type", 'text/plain; charset="EUC-KR"']]),
        body: { data: eucKr },
    };
    assert.equal(extractBodies(part).text, "가나");
});

// ============================================
// 발췌 (m4)
// ============================================

const FOOTER_HTML =
    '<div style="margin-top:32px">이 메일을 더 이상 받고 싶지 않으시면 <a href="https://sendb.kr/unsubscribe?token=unsub_x">수신거부</a>를 눌러주세요.</div>';

test("HTML 인용 떼기: gmail_quote 안 우리 꼬리말은 발췌·수신거부 판정에 들어가지 않는다 (RS25, R15·R16)", () => {
    const html =
        `<div dir="ltr">네 검토해 볼게요</div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">2026년 10월 10일 (토) 오후 3:12, 디자이너하이어 &lt;hello1@dh-mail1.test&gt;님이 작성:<br></div>` +
        `<blockquote class="gmail_quote"><p>안녕하세요</p>${FOOTER_HTML}</blockquote></div>`;
    const text = replyTextOf({ text: null, html });
    assert.equal(makeExcerpt(text), "네 검토해 볼게요");
    assert.equal(hasUnsubscribeHint("Re: 안내", text), false);
});

test("HTML 인용 떼기: Outlook divRplyFwdMsg·appendonsend·yahoo_quoted와 그 뒤 전부", () => {
    assert.equal(stripHtmlQuote('<p>좋습니다</p><div id="appendonsend"></div><hr><div id="divRplyFwdMsg">From: x</div>'), "<p>좋습니다</p>");
    assert.equal(stripHtmlQuote('<p>네</p><div class="yahoo_quoted">원문</div>'), "<p>네</p>");
    assert.equal(htmlToText("<p>a&amp;b&nbsp;c</p><style>.x{}</style><br>d&#44;"), "a&b c\n\nd,");
});

test("글 인용 떼기: >·Original Message·On … wrote:(두 줄)·작성:·From 머리 블록", () => {
    assert.equal(stripQuoted("좋아요\n\n> 이전 메일\n> 이어서").trim(), "좋아요");
    assert.equal(stripQuoted("네\n-----Original Message-----\nFrom: x").trim(), "네");
    assert.equal(stripQuoted("네\n----- 원본 메시지 -----\n본문").trim(), "네");
    assert.equal(stripQuoted("Thanks\nOn Mon, Oct 12, 2026 at 10:00 AM Kim <kim@co.test>\nwrote:\n> hi").trim(), "Thanks");
    assert.equal(stripQuoted("확인했습니다\n2026. 10. 10. 오후 3:12, 김시험 <a@b.test> 작성:\n원문").trim(), "확인했습니다");
    assert.equal(stripQuoted("확인\n________________________________\n보낸 사람: 디자이너하이어\n보낸 날짜: 2026년 10월 10일\n받는 사람: 김\n원문").trim(), "확인");
    assert.equal(stripQuoted("From: 우리 회사 소개입니다\n좋아요").trim(), "From: 우리 회사 소개입니다\n좋아요");
});

test("우리 꼬리말·수신거부 URL 줄 지우기 (m4)", () => {
    const t = stripOurFooter("네 좋아요\n이 메일을 더 이상 받고 싶지 않으시면 수신거부를 눌러주세요.\nhttps://sendb.kr/unsubscribe?token=abc\n감사합니다");
    assert.equal(t, "네 좋아요\n감사합니다");
});

test("수신거부 말 표시 (R15)", () => {
    assert.equal(hasUnsubscribeHint("Re: 안내", "수신거부 부탁드립니다"), true);
    assert.equal(hasUnsubscribeHint("Re: 안내", "이제 그만 보내주세요"), true);
    assert.equal(hasUnsubscribeHint("Re: 안내", "메일 보내지 마세요"), true);
    assert.equal(hasUnsubscribeHint("Re: unsubscribe", ""), true);
    assert.equal(hasUnsubscribeHint("Re: 안내", "Please remove me from the list"), true);
    assert.equal(hasUnsubscribeHint("Re: 안내", "비용이 어느 정도인지 궁금합니다"), false);
});

test("발췌: 500자(코드 포인트), 공백 정리", () => {
    const long = "가".repeat(600);
    assert.equal(Array.from(makeExcerpt(long)).length, 500);
    assert.equal(makeExcerpt("  a \t b\n\n\n\nc  "), "a b\n\nc");
    assert.equal(Array.from(makeExcerpt("😀".repeat(10), 3)).length, 3);
});

// ============================================
// DB 오류 (M6)
// ============================================

test("오류 갈래: 22·23 데이터 오류는 그 메일만, 08·53·57은 회차를 멈춘다 (R55)", () => {
    assert.equal(isDataError("23503"), true);
    assert.equal(isDataError("23514"), true);
    assert.equal(isDataError("22001"), true);
    assert.equal(isDataError("08006"), false);
    assert.equal(isConnectionError("08006"), true);
    assert.equal(isConnectionError("57014"), true);
    assert.equal(isConnectionError("53300"), true);
    assert.equal(isConnectionError("23503"), false);
    assert.equal(processErrorText("23514", "rs20_force"), "23514 rs20_force");
});

test("오류 갈래: postgres-js 연결 끊김 code(CONNECTION_CLOSED 등)·소켓 오류도 연결 오류다 (RH-SEC-3)", () => {
    for (const code of ["CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT"]) {
        assert.equal(isConnectionError(code), true, code);
    }
    // 드라이버의 다른 code(값 문제)는 연결 오류가 아니다 — 그 메일만 최소 줄로 남긴다
    assert.equal(isConnectionError("UNDEFINED_VALUE"), false);
    assert.equal(isConnectionError(""), false);
    assert.equal(isConnectionError(null), false);
    // drizzle이 감싼 오류에서도 code를 찾는다
    const driverError = Object.assign(new Error("write CONNECTION_CLOSED"), { code: "CONNECTION_CLOSED" });
    const wrapped = Object.assign(new Error("Failed query"), { cause: driverError });
    assert.equal(isConnectionError(pgErrorOf(wrapped)?.code), true);
});

// ============================================
// 큰 본문 (RH-SEC-1) — 정규식이 길이의 제곱으로 늘지 않는다
// ============================================

function timeMs(fn: () => unknown): number {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
}

test("큰 본문: `<a ` 수만 개·`<!--`·`<style`·`http://` 되풀이·긴 공백 줄도 글 처리가 빨리 끝난다 (RH-SEC-1)", () => {
    const big = 2 * 1024 * 1024;
    const cases: Array<[string, () => unknown]> = [
        ["html <a 반복", () => replyTextOf({ text: null, html: "<a ".repeat(big / 3) })],
        ["html 닫히지 않은 주석", () => replyTextOf({ text: null, html: "<!--".repeat(big / 4) })],
        ["html 닫히지 않은 style", () => replyTextOf({ text: null, html: "<style".repeat(big / 6) })],
        ["html class 속성 반복", () => replyTextOf({ text: null, html: `<div class="${"x ".repeat(big / 2)}` })],
        ["text http:// 반복", () => replyTextOf({ text: `${"http://".repeat(big / 7)}unsubscribe`, html: null })],
        ["text 긴 공백 줄", () => replyTextOf({ text: `안녕하세요\n${" ".repeat(big)}x`, html: null })],
        ["주소 머리글 괄호", () => parseAddressList("(".repeat(big))],
        ["주소 머리글 @ 없는 긴 글", () => parseAddressList("a".repeat(big))],
    ];
    for (const [name, fn] of cases) {
        // 고치기 전에는 120KB에서도 수 초가 걸렸다. 2MB 입력이 0.5초 안에 끝나면 길이에 비례한다
        const ms = timeMs(fn);
        assert.ok(ms < 500, `${name}: ${Math.round(ms)}ms`);
    }
});

test("큰 본문: 본문은 앞 64KB만 읽고, 인용·태그 떼기 결과는 예전과 같다 (RH-SEC-1)", () => {
    const html = `<div>문의 드립니다</div><div class="gmail_quote">On … wrote:<blockquote>이전 메일</blockquote></div>`;
    assert.equal(htmlToText(stripHtmlQuote(html)).trim(), "문의 드립니다");
    assert.equal(htmlToText("<p>a</p><style>.x{}</style><!-- c --><b>b</b>"), "a\nb");
    // 닫히지 않은 style은 그대로 두고 태그만 걷는다 (예전 정규식과 같다)
    assert.equal(htmlToText("<p>a</p><style>x"), "a\nx");
    const payload = {
        mimeType: "text/plain",
        body: { data: Buffer.from("가".repeat(100 * 1024)).toString("base64url") },
    };
    const bodies = extractBodies(payload);
    assert.equal(bodies.text?.length, BODY_SCAN_MAX_CHARS);
    // 머리글 해석은 그대로
    assert.deepEqual(parseAddressList('"홍길동" <hong@example.com>, kim@example.com (김)'), [
        { name: "홍길동", address: "hong@example.com" },
        { name: "김", address: "kim@example.com" },
    ]);
});

// ============================================
// 멈춤 계획 (7-2, M3)
// ============================================

test("멈춤 계획: 사람 회신·이어짐이면 보낸 사람과 원래 받은 사람 두 주소 모두 (R23·R48)", () => {
    const plan = planReplyEffects({
        kind: "human",
        matchStatus: "matched",
        orgId: ORG_A,
        workspaceId: 8,
        recordId: 42,
        contactEmail: "kim@co.test",
        matchedRecipient: "Info+news@Co.test",
    });
    assert.equal(plan.stop, true);
    assert.deepEqual(plan.emails, ["kim@co.test", "info+news@co.test", "info@co.test"]);
    assert.equal(plan.recordEvent, true);
    assert.equal(plan.recordId, 42);
});

test("멈춤 계획: 레코드가 지워졌으면 사건 없이 주소로만 멈춘다 (M6, R55)", () => {
    const plan = planReplyEffects({ kind: "human", matchStatus: "matched", orgId: ORG_A, workspaceId: 8, recordId: null, contactEmail: "kim@co.test", matchedRecipient: "kim@co.test" });
    assert.equal(plan.stop, true);
    assert.deepEqual(plan.emails, ["kim@co.test"]);
    assert.equal(plan.recordEvent, false);
});

test("멈춤 계획: 자동응답·내부·애매함·못 이음은 기록만, 반송은 SND (R28·R29·R56)", () => {
    const base = { orgId: ORG_A, workspaceId: 8, recordId: 1, contactEmail: "kim@co.test", matchedRecipient: null };
    for (const kind of ["auto_reply", "internal", "system", "unknown"]) {
        assert.equal(planReplyEffects({ ...base, kind, matchStatus: "matched" }).stop, false, kind);
    }
    assert.equal(planReplyEffects({ ...base, kind: "human", matchStatus: "ambiguous" }).stop, false);
    assert.equal(planReplyEffects({ ...base, kind: "human", matchStatus: "unmatched" }).stop, false);
    const bounce = planReplyEffects({ ...base, kind: "bounce", matchStatus: "matched" });
    assert.equal(bounce.bounce, true);
    assert.equal(bounce.stop, false);
});

// ============================================
// 알림 (8절)
// ============================================

test("카드 대상: 사람 회신 + 이어짐(또는 사업 추정) + 허용 워크스페이스 (R35)", () => {
    const base = { kind: "human", matchStatus: "matched", workspaceId: 8, workspaceGuessed: false, allowedWorkspaceIds: [8] };
    assert.equal(replyAlertTarget(base), "matched");
    assert.equal(replyAlertTarget({ ...base, matchStatus: "unmatched", workspaceGuessed: true }), "unmatched");
    assert.equal(replyAlertTarget({ ...base, matchStatus: "unmatched" }), null);
    assert.equal(replyAlertTarget({ ...base, matchStatus: "ambiguous" }), null);
    assert.equal(replyAlertTarget({ ...base, kind: "auto_reply" }), null);
    assert.equal(replyAlertTarget({ ...base, allowedWorkspaceIds: [9] }), null);
});

test("알림 상태: off → 없음, 24시간 넘음 → skipped, dry_run → dry_run, live → pending (R33)", () => {
    const at = { receivedAt: NOW, now: NOW };
    assert.equal(replyAlertStatus({ ...at, syncMode: "on", alertMode: "off" }), null);
    assert.deepEqual(replyAlertStatus({ ...at, syncMode: "on", alertMode: "live" }), { status: "pending", lastError: null });
    assert.deepEqual(replyAlertStatus({ ...at, syncMode: "dry_run", alertMode: "live" }), { status: "dry_run", lastError: null });
    assert.deepEqual(replyAlertStatus({ ...at, syncMode: "on", alertMode: "dry_run" }), { status: "dry_run", lastError: null });
    assert.deepEqual(
        replyAlertStatus({ syncMode: "on", alertMode: "live", receivedAt: new Date(NOW.getTime() - ALERT_MAX_AGE_MS - 1), now: NOW }),
        { status: "skipped", lastError: OLD_REPLY_ALERT_ERROR }
    );
});

function alertInput(over: Partial<ReplyAlertInput> = {}): ReplyAlertInput {
    return {
        now: NOW,
        receivedAt: NOW,
        replyId: 77,
        baseUrl: "https://sendb.kr/",
        workspaceName: "백오피스랩",
        contactFields: [
            { label: "담당자", value: "김OO", key: "contact_name", fieldType: "text" },
            { label: "전화", value: "010-0000-0000", key: "phone", fieldType: "phone" },
            { label: "메일", value: "kim@oo.co.kr", key: "email", fieldType: "email" },
            { label: "회사", value: "(주)OO상사", key: "company", fieldType: "text" },
        ],
        fromName: "김OO",
        fromEmail: "kim@oo.co.kr",
        ruleKind: "ai",
        ruleName: "백오피스랩 회계 첫 메일",
        stepText: "1번째 후속 (첫 메일 +3일)",
        recordId: 4242,
        integratedCode: "BO-0042",
        partitionName: "콜드메일 10월",
        excerpt: "비용이 어느 정도인지 궁금합니다",
        stopped: { followups: 1, automation: 0, sendQueue: 0 },
        preview: false,
        unsubscribeHint: false,
        ...over,
    };
}

test("카드 글자: 기한·연락 요약·규칙·단계·링크·발췌·멈춘 수 (R32, PRD 장면 1)", () => {
    const text = buildReplyAlertMessage(alertInput());
    const lines = text.split("\n");
    assert.equal(lines[0], "⏰ *답장 기한: 오늘 안 · 10/12(월) 18:00까지*");
    assert.equal(lines[1], "👤 김OO · 010-0000-0000 · kim@oo.co.kr · (주)OO상사");
    assert.equal(lines[2], '💬 *백오피스랩 · 회신* — 규칙 "백오피스랩 회계 첫 메일" · 1번째 후속 (첫 메일 +3일)에 회신 (10/12 10:42 도착)');
    assert.equal(lines[3], "레코드 BO-0042 (#4242) · 콜드메일 10월");
    assert.equal(
        lines[4],
        "<https://sendb.kr/records?id=4242|레코드 열기> · <https://sendb.kr/email?tab=replies&reply=77|회신 보기·처리함> · <https://sendb.kr/records/4242/journey|고객 여정>"
    );
    assert.equal(lines[6], "> 비용이 어느 정도인지 궁금합니다");
    assert.equal(lines[7], "이 고객에게 가던 자동 메일을 멈췄습니다: 후속 1통");
    assert.equal(lines[8], "_자동 답장은 나가지 않습니다. 원문을 보고 직접 답장해 주세요._");
});

test("카드 글자: 근무시간 밖 기한, 수신거부 경고, < > 바꿈, 발췌 300자, 3,800자 자름", () => {
    const night = new Date("2026-10-12T21:00:00+09:00");
    const text = buildReplyAlertMessage(
        alertInput({
            now: night,
            contactFields: [],
            fromName: "<script>",
            excerpt: `<b>${"가".repeat(400)}`,
            unsubscribeHint: true,
            stopped: null,
        })
    );
    assert.match(text, /^⏰ \*답장 기한: 출근하면 먼저 · 10\/13\(화\) 12:00까지\*/);
    assert.match(text, /👤 ‹script› ‹kim@oo\.co\.kr›/);
    assert.ok(!text.includes("<b>"));
    const excerptLine = text.split("\n").find((l) => l.startsWith("> "))!;
    assert.equal(Array.from(excerptLine).length, 2 + 300 + 1);
    assert.match(text, /⚠️ 수신거부 요청으로 보입니다/);
    assert.match(text, /이 고객에게 가던 자동 메일은 없습니다/);
    const huge = buildReplyAlertMessage(alertInput({ partitionName: "x".repeat(5000), workspaceName: "y".repeat(5000) }));
    assert.ok(Array.from(huge).length <= 3800);
});

test("카드 글자: dry_run 미리보기는 '멈출 예정', 레코드가 지워지면 회신 링크만", () => {
    const text = buildReplyAlertMessage(alertInput({ preview: true, recordId: null }));
    assert.match(text, /자동 메일 멈출 예정 \(시험 모드\): 후속 1통/);
    assert.match(text, /레코드 없음 \(지워진 레코드\)/);
    assert.ok(!text.includes("/records/"));
    assert.equal(stopCountsText({ followups: 0, automation: 0, sendQueue: 0 }, false), "이 고객에게 가던 자동 메일은 없습니다");
    assert.equal(stopCountsText({ followups: 0, automation: 2, sendQueue: 3 }, false), "이 고객에게 가던 자동 메일을 멈췄습니다: 템플릿 반복 2건 · 발송 대기열 3건");
});

test("카드 글자: 동료가 회신하면 실제로 회신한 사람을 따로 보인다 (RC-6)", () => {
    const text = buildReplyAlertMessage(alertInput({ fromName: "이동료", fromEmail: "lee.colleague@oo.co.kr" }));
    const lines = text.split("\n");
    assert.equal(lines[1], "👤 김OO · 010-0000-0000 · kim@oo.co.kr · (주)OO상사");
    assert.equal(lines[2], "✉️ 회신한 사람: 이동료 ‹lee.colleague@oo.co.kr› (레코드 연락처와 다름)");
    // 같은 사람이면 줄을 넣지 않는다
    assert.ok(!buildReplyAlertMessage(alertInput()).includes("회신한 사람"));
});

test("카드 글자: 사용자 값의 꾸밈 글자·맨 URL을 막는다 (RC-7)", () => {
    const text = buildReplyAlertMessage(
        alertInput({
            workspaceName: "QA2-*별표*_밑줄_ ~취소~ `코드` " + "가".repeat(60),
            excerpt: "*긴급* _중요_ ~취소~ `코드` <https://evil.test/login|여기를 누르세요> https://phish.example/login www.phish.example",
        })
    );
    const head = text.split("\n")[2];
    // 굵게 표시 *는 우리가 넣은 두 개뿐
    assert.equal((head.match(/\*/g) ?? []).length, 2, head);
    assert.match(head, /QA2-＊별표＊＿밑줄＿ ～취소～ ｀코드｀/);
    assert.ok(Array.from(head.split(" · 회신*")[0]).length <= 3 + 40 + 1, head);
    const excerpt = text.split("\n").find((l) => l.startsWith("> "))!;
    assert.ok(!/https?:\/\//.test(excerpt), excerpt);
    assert.match(excerpt, /hxxps:\/\/phish\.example\/login/);
    assert.match(excerpt, /www\[\.\]phish/);
    assert.ok(!/[*_~`]/.test(excerpt.slice(2)), excerpt);
});

test("보낼 때 기한 줄을 그때 기준으로 다시 쓴다 (RC-12)", () => {
    const text = buildReplyAlertMessage(alertInput());
    const later = new Date("2026-10-13T10:05:00+09:00");
    const sent = refreshReplyCardForSend(text, later);
    assert.equal(sent.split("\n")[0], "⏰ *답장 기한: 오늘 안 · 10/13(화) 18:00까지*");
    assert.equal(sent.split("\n").slice(1).join("\n"), text.split("\n").slice(1).join("\n"));
    assert.equal(refreshReplyCardForSend("💬 기한 없는 글", later), "💬 기한 없는 글");
});

test("못 이은 회신 카드: 기한·자동 메일 상태를 이어진 카드와 같은 말로 (RC-10)", () => {
    const text = buildUnmatchedReplyAlertMessage({
        now: NOW,
        receivedAt: NOW,
        replyId: 5,
        baseUrl: "https://sendb.kr",
        workspaceName: "백오피스랩",
        fromName: "김",
        fromEmail: "kim@co.test",
        toEmail: "cs@dh-mail1.test",
        subject: "문의",
        excerpt: "가격이 궁금합니다",
    });
    assert.match(text, /^⏰ \*답장 기한: 오늘 안 · 10\/12\(월\) 18:00까지\*\n💬 \*백오피스랩 · 새 회신 \(어느 메일의 답장인지 못 찾음\)\* — 10\/12 10:42 도착/);
    assert.match(text, /이 주소로 나갈 자동 메일은 보내기 직전에 막힙니다/);
    assert.match(text, /보낸 사람 김 ‹kim@co\.test› → 받은 주소 cs@dh-mail1\.test/);
    assert.match(text, /<https:\/\/sendb\.kr\/email\?tab=replies&reply=5\|회신 보기>/);
});

test("운영 알림: 주소·비밀값 없음, 6시간에 한 번, 일시 오류는 1시간 넘게 이어질 때만 (R4·R61)", () => {
    const msg = buildOpsAlertMessage("auth", new Date("2026-10-11T10:45:00+09:00"), { baseUrl: "https://sendb.kr" });
    assert.match(msg, /^⚠️ 샌드비 회신 읽기 멈춤: 메일함 연결 끊김/);
    assert.match(msg, /영향: 10\/11 10:45 뒤로 회신한 사람에게도/);
    assert.match(msg, /할 일: 개발 담당에게 .*13-4절/);
    assert.match(msg, /<https:\/\/sendb\.kr\/email\?tab=replies\|회신 탭 보기>/);
    assert.ok(!/@/.test(msg));
    const base = { now: NOW, lastSuccessAt: new Date(NOW.getTime() - 10 * 60 * 1000), firstErrorAt: null, opsAlertedAt: null };
    assert.equal(shouldSendOpsAlert({ ...base, code: "auth" }), true);
    assert.equal(shouldSendOpsAlert({ ...base, code: "auth", opsAlertedAt: new Date(NOW.getTime() - 60 * 60 * 1000) }), false);
    assert.equal(shouldSendOpsAlert({ ...base, code: "auth", opsAlertedAt: new Date(NOW.getTime() - 7 * 60 * 60 * 1000) }), true);
    assert.equal(shouldSendOpsAlert({ ...base, code: "transient" }), false);
    assert.equal(shouldSendOpsAlert({ ...base, code: "transient", lastSuccessAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }), true);
    assert.equal(replyErrorText("mailbox_mismatch").includes("기본 주소"), true);
});

test("운영 알림: 정체 글은 원래 원인으로 할 일을 고르고 원인을 첫 줄에 쓴다 (RO-2·RC-15)", () => {
    const msg = buildOpsAlertMessage("auth", new Date("2026-10-11T10:45:00+09:00"), { stale: true });
    const lines = msg.split("\n");
    assert.match(lines[0], /6시간 넘게 회신을 읽지 못했습니다 — 원인: 메일함 연결 끊김/);
    assert.match(lines[2], /갱신 토큰 다시 받기/);
    assert.ok(!msg.includes("저절로 풀리는지"));
    assert.match(buildOpsAlertMessage("mailbox_mismatch", null, { stale: true }), /`REPLY_MAILBOX`/);
});

test("운영 알림: dry_run은 자동 메일이 원래 멈추지 않는다고 쓰고, 개발 서버면 서버를 밝힌다 (RO-9·RO-10)", () => {
    const msg = buildOpsAlertMessage("auth", null, { syncMode: "dry_run", serverLabel: "[개발 서버 · dev.example.test] " });
    assert.match(msg, /^⚠️ \[개발 서버 · dev\.example\.test\] 샌드비 회신 읽기 멈춤/);
    assert.match(msg, /시험 모드\(dry_run\)라 자동 메일 멈춤은 아직 꺼져 있습니다/);
    assert.ok(!msg.includes("후속·AI 첫 메일이 나갈 수 있습니다"));
    assert.equal(replyServerLabel({ serverKind: "production", baseUrl: "https://sendb.kr" }), "");
    assert.equal(replyServerLabel({ serverKind: "test", baseUrl: "https://dev.example.test" }), "[개발 서버 · dev.example.test] ");
});

test("운영 알림: 회복 글은 짧은 원인만, 할 일 문장 없이 (RO-8)", () => {
    const msg = buildOpsRecoveredMessage("auth", new Date("2026-10-11T19:43:00+09:00"));
    assert.equal(msg, "✅ 샌드비 회신 읽기가 다시 됩니다 (10/11 19:43) — 직전 원인: 메일함 연결 끊김 (갱신 토큰 만료·취소). 멈춘 동안 온 회신도 이어서 읽고 카드를 보냅니다");
    assert.ok(!msg.includes("받아 주세요"));
});

test("운영 알림: 원인이 바뀌면 6시간을 기다리지 않고, 회복 뒤 1시간 안에 다시 나면 바로 알리지 않는다 (RO-7·RO-15)", () => {
    const hourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    const base = { now: NOW, lastSuccessAt: null, firstErrorAt: NOW, opsAlertedAt: hourAgo, opsAlertedCode: "auth" };
    assert.equal(shouldSendOpsAlert({ ...base, code: "mailbox_mismatch" }), true);
    assert.equal(shouldSendOpsAlert({ ...base, code: "auth" }), false);
    assert.equal(shouldSendOpsAlert({ ...base, code: "transient" }), false);
    const flap = { now: NOW, lastSuccessAt: new Date(NOW.getTime() - 5 * 60 * 1000), opsAlertedAt: null, recoveredAt: new Date(NOW.getTime() - 5 * 60 * 1000) };
    assert.equal(shouldSendOpsAlert({ ...flap, code: "auth", firstErrorAt: NOW }), false);
    assert.equal(shouldSendOpsAlert({ ...flap, code: "auth", firstErrorAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }), true);
    assert.equal(shouldSendOpsAlert({ ...flap, code: "auth", firstErrorAt: NOW, recoveredAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }), true);
});

test("알림 상태: 마지막 성공 뒤에 온 회신(장애로 늦게 읽음)은 24시간이 지나도 보낸다 (RC-2)", () => {
    const old = new Date(NOW.getTime() - ALERT_MAX_AGE_MS - 60 * 60 * 1000);
    const live = { syncMode: "on" as const, alertMode: "live" as const, receivedAt: old, now: NOW };
    assert.equal(replyAlertStatus(live)?.status, "skipped");
    assert.equal(replyAlertStatus({ ...live, lastSuccessAt: new Date(old.getTime() - 60 * 1000) })?.status, "pending");
    assert.equal(replyAlertStatus({ ...live, lastSuccessAt: new Date(old.getTime() + 60 * 1000) })?.status, "skipped");
});

test("설정: 웹훅이 없거나 형식이 틀린 워크스페이스·운영 웹훅은 띠 경고 (RC-4·RO-12·CT-6)", () => {
    const c = resolveReplyConfig({
        ...PROD_ENV,
        REPLY_ALERT_MODE: "live",
        REPLY_SYNC_MODE: "on",
        REPLY_WORKSPACE_IDS: "2,4,5",
        DEEP_ALERT_WEBHOOK_URL_2: "http://chat.googleapis.com/v1/spaces/W2/messages",
        DEEP_ALERT_WEBHOOK_URL_5: "https://example.com/hook",
        DEEP_ALERT_WEBHOOK_URL_4: "",
        REPLY_OPS_WEBHOOK_URL: "http://plain.test",
        SEND_HEALTH_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/OPS/messages?key=k&token=t",
    });
    assert.deepEqual(c.webhookByWorkspace, {});
    assert.ok(c.warnings.some((w) => w.code === "alert_webhook_missing" && w.text.includes("4")));
    assert.ok(c.warnings.some((w) => w.code === "alert_webhook_invalid" && w.text.includes("2, 5")));
    assert.ok(c.warnings.some((w) => w.code === "ops_webhook_invalid" && w.text.includes("REPLY_OPS_WEBHOOK_URL")));
    assert.equal(c.opsWebhook?.source, "SEND_HEALTH_WEBHOOK_URL");
    assert.deepEqual(c.webhookChecks.map((x) => x.source), ["DEEP_ALERT_WEBHOOK_URL_2", "DEEP_ALERT_WEBHOOK_URL_4", "DEEP_ALERT_WEBHOOK_URL_5"]);
});

// ============================================
// Gmail 목록 조회 q
// ============================================

test("목록 조회 q: history 404면 마지막 성공 1시간 전 (최소 2일·최대 30일 전)", () => {
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    assert.equal(fallbackListQuery(new Date(NOW.getTime() - 3 * DAY), NOW), `after:${sec(new Date(NOW.getTime() - 3 * DAY - 3600_000))} -in:sent -in:chats -in:drafts`);
    assert.equal(fallbackListQuery(new Date(NOW.getTime() - 60_000), NOW), `after:${sec(new Date(NOW.getTime() - 2 * DAY))} -in:sent -in:chats -in:drafts`);
    assert.equal(fallbackListQuery(new Date(NOW.getTime() - 90 * DAY), NOW), `after:${sec(new Date(NOW.getTime() - 30 * DAY))} -in:sent -in:chats -in:drafts`);
    assert.equal(fallbackListQuery(null, NOW), `after:${sec(new Date(NOW.getTime() - 2 * DAY))} -in:sent -in:chats -in:drafts`);
    assert.equal(backfillListQuery(new Date(1000_000), new Date(2000_000)), "after:1000 before:2000 -in:sent -in:chats -in:drafts");
    assert.equal(nextBackfillBefore(1_760_000_000_500).getTime(), 1_760_000_001_000);
});

// ============================================
// 통계·연락 칸
// ============================================

test("통계: 오늘(KST) 누적은 날짜가 바뀌면 새로", () => {
    const run = { ...emptyRunCounts(), listed: 3, stored: 1 };
    const first = mergeDailyCounts(null, run, NOW);
    assert.equal(first.counts.listed, 3);
    const second = mergeDailyCounts({ today: first }, run, NOW);
    assert.equal(second.counts.listed, 6);
    const nextDay = mergeDailyCounts({ today: second }, run, new Date(NOW.getTime() + DAY));
    assert.equal(nextDay.counts.listed, 3);
});

test("연락 칸: _키·빈 값·객체 값은 빼고 글자로", () => {
    const fields = contactFieldsOf(
        [
            { key: "name", label: "이름", fieldType: "text" },
            { key: "_companyResearch", label: "조사", fieldType: "text" },
            { key: "phone", label: "전화", fieldType: "phone" },
            { key: "memo", label: "메모", fieldType: "text" },
        ],
        { name: " 김 ", _companyResearch: { a: 1 }, phone: 1012345678, memo: { x: 1 } }
    );
    assert.deepEqual(fields, [
        { label: "이름", value: "김", key: "name", fieldType: "text" },
        { label: "전화", value: "1012345678", key: "phone", fieldType: "phone" },
    ]);
});
