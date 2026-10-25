import { test } from "node:test";
import assert from "node:assert";
import {
    classifyDsn,
    classifyFailSide,
    bounceBlockClass,
    bounceBlockSignal,
    classifyNhnFailure,
    isRecipientSideFailure,
    dsnLabel,
    formatNhnDateTime,
    initialCursor,
    isCursorCaughtUp,
    isFinalNhnCode,
    mapNhnStatus,
    nextUpdateWindow,
    pairNhnRows,
    pairUpdatedMails,
    parseNhnDate,
    resolveStatusSyncConfig,
    shrinkUpdateSpan,
    syncWarning,
    splitBudget,
} from "./email-status-sync-rules";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── mapNhnStatus (3-1 표, H1) ──

test("SST2는 sent·확정, 사유 칸은 쓰지 않는다", () => {
    const w = mapNhnStatus({ mailStatusCode: "SST2", resultDate: "2026-10-11 10:00:00" });
    assert.ok(w);
    assert.equal(w.logStatus, "sent");
    assert.equal(w.final, true);
    assert.equal(w.reasonCode, null);
    assert.equal(w.failSide, null);
    assert.equal(w.resultAt?.toISOString(), "2026-10-11T01:00:00.000Z");
});

test("SST3는 failed + dsnCode·dsnMessage, 받는 쪽 실패", () => {
    const w = mapNhnStatus({ mailStatusCode: "SST3", dsnCode: "5.1.1", dsnMessage: "550 5.1.1 user unknown" });
    assert.ok(w);
    assert.equal(w.logStatus, "failed");
    assert.equal(w.reasonCode, "5.1.1");
    assert.equal(w.reasonText, "550 5.1.1 user unknown");
    assert.equal(w.dsnCode, "5.1.1");
    assert.equal(w.failSide, "recipient");
});

test("SST3 dsn 없음이면 '발송 실패(SST3)'", () => {
    const w = mapNhnStatus({ mailStatusCode: "SST3", dsnCode: "", dsnMessage: null });
    assert.equal(w?.reasonCode, "SST3");
    assert.equal(w?.reasonText, "발송 실패(SST3)");
    assert.equal(w?.dsnCode, null);
});

test("SST3 5.7.26 DMARC 거절은 발신 쪽 실패 (SND-06)", () => {
    const w = mapNhnStatus({
        mailStatusCode: "SST3",
        dsnCode: "5.7.26",
        dsnMessage: "550 5.7.26 unauthenticated email is not accepted due to domain's DMARC policy",
    });
    assert.equal(w?.failSide, "sender");
});

test("SST5·SST7·SST8은 failed + 코드별 사유, SST7·8은 발신 쪽", () => {
    assert.deepEqual(
        ["SST5", "SST7", "SST8"].map((c) => {
            const w = mapNhnStatus({ mailStatusCode: c });
            return [w?.logStatus, w?.reasonCode, w?.reasonText, w?.failSide];
        }),
        [
            ["failed", "SST5", "NHN 수신거부(SST5)", null],
            ["failed", "SST7", "발신 인증 실패(SST7)", "sender"],
            ["failed", "SST8", "화이트리스트로 인한 실패(SST8)", "sender"],
        ]
    );
});

test("SST0·1·4는 진행 중 (status 그대로), 모르는 코드는 null", () => {
    for (const c of ["SST0", "SST1", "SST4"]) {
        const w = mapNhnStatus({ mailStatusCode: c });
        assert.equal(w?.logStatus, null);
        assert.equal(w?.final, false);
    }
    assert.equal(mapNhnStatus({ mailStatusCode: "SST9" }), null);
    assert.equal(mapNhnStatus({ mailStatusCode: null }), null);
});

test("isFinalNhnCode", () => {
    assert.deepEqual(["SST0", "SST2", "SST3", "SST4", "SST5", "SST7", "SST8", null].map(isFinalNhnCode), [false, true, true, false, true, true, true, false]);
});

// ── classifyFailSide·classifyDsn (H11) ──

test("classifyFailSide: 5.7.x·SPF·DKIM·DMARC·policy·authenticat → sender", () => {
    assert.equal(classifyFailSide("5.7.1", null), "sender");
    assert.equal(classifyFailSide("5.1.1", "SPF check failed"), "sender");
    assert.equal(classifyFailSide(null, "message rejected by DKIM"), "sender");
    assert.equal(classifyFailSide("5.0.0", "Not authenticated"), "sender");
    assert.equal(classifyFailSide("5.1.1", "user unknown"), "recipient");
    assert.equal(classifyFailSide(null, null), "recipient");
});

test("classifyDsn: failed+5 → hard, failed+4 → expired, delayed·4 → soft, 그 밖 unknown", () => {
    assert.equal(classifyDsn("failed", "5.1.1"), "hard");
    assert.equal(classifyDsn(null, "5.1.1"), "hard");
    assert.equal(classifyDsn("failed", "4.4.7"), "expired");
    assert.equal(classifyDsn("delayed", "4.2.2"), "soft");
    assert.equal(classifyDsn(null, "4.2.2"), "soft");
    assert.equal(classifyDsn("delivered", "2.0.0"), "unknown");
    assert.equal(classifyDsn(null, null), "unknown");
});

test("dsnLabel", () => {
    assert.equal(dsnLabel("5.1.1"), "5.1.1 받는 주소 없음");
    assert.equal(dsnLabel("5.9.9"), "5.9.9 배달 실패");
    assert.equal(dsnLabel(null), "상태 코드 없음");
});

// ── 날짜 ──

test("formatNhnDateTime은 KST 'yyyy-MM-dd HH:mm:ss', parseNhnDate와 되돌아간다", () => {
    const d = new Date("2026-10-11T00:30:15.999Z");
    assert.equal(formatNhnDateTime(d), "2026-10-11 09:30:15");
    assert.equal(parseNhnDate("2026-10-11 09:30:15")?.toISOString(), "2026-10-11T00:30:15.000Z");
    assert.equal(parseNhnDate("2026-10-11T00:30:15Z")?.toISOString(), "2026-10-11T00:30:15.000Z");
    assert.equal(parseNhnDate(""), null);
    assert.equal(parseNhnDate("not a date"), null);
});

// ── 커서 창 (H3·H9) ──

test("nextUpdateWindow: [커서 − 5분, min(커서 + 1시간, now − 1분)]", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const cursor = new Date("2026-10-11T05:00:00Z");
    const w = nextUpdateWindow(cursor, now);
    assert.equal(w?.start.toISOString(), "2026-10-11T04:55:00.000Z");
    assert.equal(w?.end.toISOString(), "2026-10-11T06:00:00.000Z");
});

test("nextUpdateWindow: 지금 가까이면 now − 1분에서 끊고, 따라잡았으면 null", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    const w = nextUpdateWindow(new Date(now.getTime() - 30 * MIN), now);
    assert.equal(w?.end.toISOString(), "2026-10-11T09:59:00.000Z");
    assert.equal(nextUpdateWindow(new Date(now.getTime() - MIN), now), null);
    assert.equal(nextUpdateWindow(new Date(now.getTime() - MIN + 500), now), null);
});

test("initialCursor: 8일 전, 0이면 1시간 전. isCursorCaughtUp은 지금 − 1시간 안", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    assert.equal(initialCursor(now, 8).toISOString(), "2026-10-03T10:00:00.000Z");
    assert.equal(initialCursor(now, 0).toISOString(), "2026-10-11T09:00:00.000Z");
    assert.equal(isCursorCaughtUp(new Date(now.getTime() - HOUR), now), true);
    assert.equal(isCursorCaughtUp(new Date(now.getTime() - HOUR - 1), now), false);
});

test("8일 따라잡기: 1시간 창 192개를 이어 읽으면 따라잡는다 (H9)", () => {
    const now = new Date("2026-10-11T10:00:30Z");
    let cursor = initialCursor(now, 8);
    let windows = 0;
    for (;;) {
        const w = nextUpdateWindow(cursor, now);
        if (!w) break;
        cursor = w.end;
        windows++;
        assert.ok(windows < 1000);
    }
    assert.equal(windows, 192);
    assert.equal(isCursorCaughtUp(cursor, now), true);
});

// ── 짝짓기 (H2·H3) ──

test("pairUpdatedMails: 요청 번호로 잇고, 기록 없는 결과는 unpaired, 여럿이면 multi", () => {
    const r = pairUpdatedMails(
        [
            { requestId: "r1", mailStatusCode: "SST2" },
            { requestId: "r2", mailStatusCode: "SST3" },
            { requestId: "r3", mailStatusCode: "SST2" },
            { requestId: "r4", mailStatusCode: "SST2" },
        ],
        [
            { id: 1, requestId: "r1" },
            { id: 2, requestId: "r2" },
            { id: 4, requestId: "r4" },
            { id: 5, requestId: "r4" },
        ]
    );
    assert.deepEqual(r.pairs.map((p) => [p.logId, p.mail.mailStatusCode]), [[1, "SST2"], [2, "SST3"]]);
    assert.equal(r.unpaired, 1);
    assert.deepEqual(r.multiRequestIds, ["r4"]);
});

test("pairUpdatedMails: 같은 요청 번호가 겹쳐 오면 확정 코드, 같으면 나중에 바뀐 것", () => {
    const r = pairUpdatedMails(
        [
            { requestId: "r1", mailStatusCode: "SST1", mailStatusUpdatedDate: "2026-10-11 10:05:00" },
            { requestId: "r1", mailStatusCode: "SST2", mailStatusUpdatedDate: "2026-10-11 10:00:00" },
            { requestId: "r2", mailStatusCode: "SST2", mailStatusUpdatedDate: "2026-10-11 10:00:00" },
            { requestId: "r2", mailStatusCode: "SST3", mailStatusUpdatedDate: "2026-10-11 11:00:00" },
        ],
        [
            { id: 1, requestId: "r1" },
            { id: 2, requestId: "r2" },
        ]
    );
    assert.deepEqual(r.pairs.map((p) => p.mail.mailStatusCode), ["SST2", "SST3"]);
});

test("pairNhnRows: 요청 번호에 하나씩이면 주소가 달라도(대문자) 잇는다 (H2)", () => {
    const pairs = pairNhnRows(
        [{ requestId: "r1", mailStatusCode: "SST2", receiveMailAddr: "UPPER@Example.Test" }],
        [{ id: 1, requestId: "r1", recipientEmail: "upper@example.test" }]
    );
    assert.deepEqual(pairs.map((p) => p.logId), [1]);
    const loose = pairNhnRows(
        [{ requestId: "r1", mailStatusCode: "SST2", receiveMailAddr: "other@example.test" }],
        [{ id: 1, requestId: "r1", recipientEmail: "a@example.test" }]
    );
    assert.deepEqual(loose.map((p) => p.logId), [1]);
});

test("pairNhnRows: 여럿이면 lower(trim(주소))로 잇는다", () => {
    const pairs = pairNhnRows(
        [
            { requestId: "r1", mailStatusCode: "SST2", receiveMailAddr: " A@Example.test " },
            { requestId: "r1", mailStatusCode: "SST3", receiveMailAddr: "b@example.test" },
        ],
        [
            { id: 1, requestId: "r1", recipientEmail: "a@example.test" },
            { id: 2, requestId: "r1", recipientEmail: "B@example.test" },
            { id: 3, requestId: "r1", recipientEmail: "c@example.test" },
        ]
    );
    assert.deepEqual(pairs.map((p) => [p.logId, p.mail.mailStatusCode]), [[1, "SST2"], [2, "SST3"]]);
});

// ── 예산 (H4) ──

test("splitBudget: 고르게 나누고 남는 몫은 밀린 묶음에", () => {
    assert.deepEqual(splitBudget(300, [1000, 1000]), [150, 150]);
    assert.deepEqual(splitBudget(300, [10, 1000]), [10, 290]);
    assert.deepEqual(splitBudget(10, [5, 5, 5]), [4, 3, 3]);
    assert.deepEqual(splitBudget(0, [5]), [0]);
    assert.deepEqual(splitBudget(100, []), []);
    const s = splitBudget(301, [300, 2, 300]);
    assert.equal(s.reduce((a, b) => a + b, 0), 301);
    assert.equal(s[1], 2);
});

// ── 실패 갈래·설정 ──

test("classifyNhnFailure: 401·403 키, 429 한도, 400은 update-mails에서만 오래된 창 거절", () => {
    assert.equal(classifyNhnFailure(401), "auth");
    assert.equal(classifyNhnFailure(403), "auth");
    assert.equal(classifyNhnFailure(429), "rate_limited");
    assert.equal(classifyNhnFailure(500), "transient");
    assert.equal(classifyNhnFailure(null), "transient");
    assert.equal(classifyNhnFailure(400), "transient");
    // 창 시작이 하루보다 오래됐을 때만 오래된 창 거절 — 새 창의 400은 설정 오류일 수 있어 일시 오류로 (OPS-7)
    const now = new Date("2026-10-11T10:00:00+09:00");
    assert.equal(classifyNhnFailure(400, { updateWindow: true, windowStart: new Date(now.getTime() - 25 * 3600 * 1000), now }), "rejected_window");
    assert.equal(classifyNhnFailure(400, { updateWindow: true, windowStart: new Date(now.getTime() - 2 * 3600 * 1000), now }), "transient");
    assert.equal(classifyNhnFailure(400, { updateWindow: true }), "transient");
});

test("resolveStatusSyncConfig 기본값과 off", () => {
    assert.deepEqual(resolveStatusSyncConfig({}), { enabled: true, maxCalls: 300, fallbackCalls: 30, backfillDays: 8, pageSize: 100 });
    const c = resolveStatusSyncConfig({ NHN_STATUS_SYNC: "OFF", NHN_STATUS_SYNC_MAX_CALLS: "50", NHN_STATUS_BACKFILL_DAYS: "0", NHN_STATUS_PAGE_SIZE: "x" });
    assert.equal(c.enabled, false);
    assert.equal(c.maxCalls, 50);
    assert.equal(c.backfillDays, 0);
    assert.equal(c.pageSize, 100);
});

test("반송 막기 갈래 (F2, PRD SND-2): 발신 쪽 5.7.x는 막지 않고, 주소 없음은 바로, 메일함 가득은 3번 쌓일 때만", () => {
    assert.equal(bounceBlockClass("5.7.1", "550 5.7.1 likely unsolicited mail", null), "sender");
    assert.equal(bounceBlockClass("5.7.26", "unauthenticated email from x is not accepted due to domain's DMARC policy", "sender"), "sender");
    assert.equal(bounceBlockClass("5.0.0", "rejected by policy", null), "sender");
    assert.equal(bounceBlockClass("5.1.1", "550 5.1.1 The email account that you tried to reach does not exist", null), "address");
    // 상태 코드가 주소 없음이면 사유 글에 policy가 섞여도 주소 없음
    assert.equal(bounceBlockClass("5.1.1", "user unknown (see policy)", "sender"), "address");
    assert.equal(bounceBlockClass("5.1.10", null, null), "address");
    assert.equal(bounceBlockClass("5.4.4", null, null), "address");
    assert.equal(bounceBlockClass("5.0.0", "550 User unknown", null), "address");
    assert.equal(bounceBlockClass("5.2.2", "552 mailbox full", null), "transient");
    assert.equal(bounceBlockClass("5.0.0", null, null), "transient");

    const sig = (id: number, status: string, key = `m${id}`) => ({ id, status, diagnostic: null, failSide: null, messageKey: key });
    assert.equal(bounceBlockSignal([sig(1, "5.7.1")]), null);
    assert.equal(bounceBlockSignal([sig(2, "5.1.1")]), 2);
    assert.equal(bounceBlockSignal([sig(3, "5.2.2"), sig(2, "5.2.2")]), null);
    assert.equal(bounceBlockSignal([sig(4, "5.2.2"), sig(3, "5.2.2"), sig(2, "5.2.2")]), 4);
    // 같은 반송 안내(같은 메일)를 두 번 세지 않는다
    assert.equal(bounceBlockSignal([sig(4, "5.2.2", "a"), sig(3, "5.2.2", "a"), sig(2, "5.2.2", "b")]), null);
    // 발신 쪽 실패는 3번이어도 막지 않는다
    assert.equal(bounceBlockSignal([sig(4, "5.7.1"), sig(3, "5.7.1"), sig(2, "5.7.1")]), null);
});

test("받는 쪽 실패 (F4): SST3·반송 안내로 failed면 후속을 보내지 않고, 발신 쪽 실패·보낼 때 거절은 아니다", () => {
    const base = { status: "failed", nhnStatusCode: null, deliveryFailSource: null, deliveryFailSide: null };
    assert.equal(isRecipientSideFailure({ ...base, nhnStatusCode: "SST3", deliveryFailSource: "nhn", deliveryFailSide: "recipient" }), true);
    assert.equal(isRecipientSideFailure({ ...base, deliveryFailSource: "dsn", deliveryFailSide: "recipient" }), true);
    assert.equal(isRecipientSideFailure({ ...base, nhnStatusCode: "SST7" }), false);
    assert.equal(isRecipientSideFailure({ ...base, nhnStatusCode: "SST3", deliveryFailSide: "sender" }), false);
    assert.equal(isRecipientSideFailure(base), false);
    assert.equal(isRecipientSideFailure({ ...base, status: "sent", nhnStatusCode: "SST2" }), false);
});

test("UX-197 shrinkUpdateSpan: 남은 질문으로 다 못 읽는 창은 비율대로 줄이고, 더 못 줄이면 null", () => {
    const HOUR = 60 * MIN;
    assert.equal(shrinkUpdateSpan(HOUR, 3, 5), HOUR, "다 읽을 수 있으면 그대로");
    assert.equal(shrinkUpdateSpan(HOUR, 12, 4), 20 * MIN, "4/12로 줄인다");
    assert.equal(shrinkUpdateSpan(HOUR, 10_000, 1), MIN, "가장 짧은 길이 아래로는 줄이지 않는다");
    assert.equal(shrinkUpdateSpan(MIN, 50, 1), null, "이미 가장 짧으면 null — 커서를 옮기지 않는다");
    assert.equal(shrinkUpdateSpan(HOUR, 5, 0), null, "물을 수 없으면 null");
    // 초 단위로 내린다
    assert.equal((shrinkUpdateSpan(HOUR, 7, 3) ?? 1) % 1000, 0);
});

test("UX-197 nextUpdateWindow: 줄인 길이로 창 끝을 당긴다 (앞 겹침은 그대로)", () => {
    const now = new Date("2026-10-25T03:00:00Z");
    const cursor = new Date("2026-10-25T00:00:00Z");
    const w = nextUpdateWindow(cursor, now, 10 * MIN)!;
    assert.equal(w.end.getTime(), cursor.getTime() + 10 * MIN);
    assert.equal(w.start.getTime(), cursor.getTime() - 5 * MIN);
});

test("UX-260 syncWarning: 실패가 없으면 null, 키 오류는 설정 확인, 그 밖은 일부 실패 안내", () => {
    assert.equal(syncWarning({ errors: 0 }), null);
    const auth = syncWarning({ errors: 1, lastFailure: { kind: "auth", text: "NHN 키 확인 필요 (HTTP 401)" } })!;
    assert.match(auth, /^NHN 키 확인 필요 \(HTTP 401\) — .*appKey·secretKey/);
    const partial = syncWarning({ errors: 2, lastFailure: { kind: "transient", text: "NHN 조회 일시 오류" } })!;
    assert.match(partial, /일부가 실패/);
    assert.match(syncWarning({ errors: 1 })!, /^NHN 조회 일시 오류/);
});
