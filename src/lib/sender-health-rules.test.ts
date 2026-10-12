import { test } from "node:test";
import assert from "node:assert";
import {
    ALERT_TEXT_MAX,
    DEFAULT_THRESHOLDS,
    authBurstText,
    batchAlertText,
    binomUpperTail,
    dailyReportText,
    dangerEpisodeStart,
    dedupeKey,
    evaluateHealth,
    hasReportableItems,
    healthCategoryOf,
    isAuthBurst,
    isOutlierCell,
    isQuietHour,
    isReportDue,
    kstDayStart,
    manualHoldMessage,
    partitionDangerText,
    planActions,
    rateBucket,
    releaseText,
    resolveHealthWebhook,
    resolveSendHealthConfig,
    senderDangerText,
    syncGate,
    type BurstRow,
    type EvaluateInput,
    type HealthBucket,
    type HealthPartitionInfo,
    type HealthSenderInfo,
    type SendLogFacts,
    capText,
    healthThreadKey,
    healthWebhookInfo,
    mergeSyncAlertTexts,
    senderWithPartitionsText,
    syncAlertText,
} from "./sender-health-rules";

const NOW = new Date("2026-10-12T03:00:00Z"); // KST 12:00
const HOUR = 60 * 60 * 1000;

function bucket(p: number | null, s: number | null, counts: Partial<HealthBucket> = {}, opts: Partial<HealthBucket> = {}): HealthBucket {
    return {
        partitionId: p,
        senderProfileId: s,
        senderDomain: "a.test",
        hourStart: new Date(NOW.getTime() - 2 * HOUR),
        afterP: true,
        afterS: true,
        success: 0,
        failed: 0,
        dsnOnly: 0,
        senderSide: 0,
        nhnUnsub: 0,
        unknown: 0,
        ...counts,
        ...opts,
    };
}

function pinfo(id: number, extra: Partial<HealthPartitionInfo> = {}): HealthPartitionInfo {
    return { id, workspaceId: 1, name: `P${id}`, floorAt: null, activeHoldId: null, heldOrReleasedRecently: false, alertOnly: false, ...extra };
}

function sinfo(id: number, extra: Partial<HealthSenderInfo> = {}): HealthSenderInfo {
    return {
        id,
        email: `cs${id}@a.test`,
        domain: "a.test",
        isDefault: false,
        isPaused: false,
        pausedSource: null,
        healthAction: "auto",
        floorAt: null,
        ...extra,
    };
}

function evaluate(over: Partial<EvaluateInput>) {
    const buckets = over.buckets ?? [];
    const pids = new Set(buckets.map((b) => b.partitionId).filter((x): x is number => x !== null));
    const sids = new Set(buckets.map((b) => b.senderProfileId).filter((x): x is number => x !== null));
    return evaluateHealth({
        now: NOW,
        dsnInRate: false,
        buckets,
        slow: [],
        burst: [],
        partitions: over.partitions ?? [...pids].map((id) => pinfo(id)),
        senders: over.senders ?? [...sids].map((id) => sinfo(id)),
        ...over,
    });
}

const pState = (ev: ReturnType<typeof evaluateHealth>, id: number) => ev.partitions.find((p) => p.partitionId === id);
const sState = (ev: ReturnType<typeof evaluateHealth>, id: number) => ev.senders.find((s) => s.profileId === id);

// ── 갈래 (5-1, H12) ──

function facts(over: Partial<SendLogFacts>): SendLogFacts {
    return { triggerType: "ai_auto", status: "sent", requestId: "r", nhnStatusCode: null, deliveryFailSource: null, deliveryFailSide: null, ...over };
}

test("healthCategoryOf: 5-1 표 순서", () => {
    assert.equal(healthCategoryOf(facts({ triggerType: "test_followup", nhnStatusCode: "SST3" })), "test");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST7", status: "failed" })), "sender_side");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST3", deliveryFailSide: "sender", status: "failed" })), "sender_side");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST5", status: "failed" })), "nhn_unsub");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST3", status: "failed", deliveryFailSource: "nhn" })), "failed");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST2", status: "failed", deliveryFailSource: "dsn" })), "dsn_only");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST2" })), "success");
    assert.equal(healthCategoryOf(facts({ requestId: null, status: "failed" })), "send_reject");
    assert.equal(healthCategoryOf(facts({ status: "failed" })), "send_reject");
    // NHN 결과 없이 반송 안내만 있는 기록은 미확정 (SND-01 (a)·SND-02) — 보낼 때 거절로 세지 않는다
    assert.equal(healthCategoryOf(facts({ status: "failed", deliveryFailSource: "dsn", deliveryFailSide: "recipient" })), "unknown");
    assert.equal(healthCategoryOf(facts({ status: "failed", deliveryFailSource: "dsn", deliveryFailSide: "sender" })), "unknown");
    assert.equal(healthCategoryOf(facts({ nhnStatusCode: "SST1" })), "unknown");
});

// ── 이항 윗꼬리 (5-4) ──

test("binomUpperTail: 알려진 값과 경계", () => {
    // P(X ≥ 3 | 50, 0.025) ≈ 0.129 — 설계 5-5 "정상 2.5% 명단에서 칸 3/50"
    assert.ok(Math.abs(binomUpperTail(50, 3, 0.025) - 0.1293) < 0.002);
    // P(X ≥ 4 | 60, 0.005) ≈ 0.00026
    const p = binomUpperTail(60, 4, 0.005);
    assert.ok(p > 0.0001 && p < 0.001, String(p));
    assert.equal(binomUpperTail(10, 0, 0.5), 1);
    assert.equal(binomUpperTail(10, 11, 0.5), 0);
    assert.equal(binomUpperTail(10, 1, 0), 0);
    assert.ok(Math.abs(binomUpperTail(10, 5, 0.5) - 0.623) < 0.001);
    // 큰 n에서도 숫자가 깨지지 않는다
    const big = binomUpperTail(5000, 300, 0.05);
    assert.ok(big > 0 && big < 0.05, String(big));
});

test("isOutlierCell: 칸 50·3·5%, 나머지 100통, p < 0.01", () => {
    assert.equal(isOutlierCell({ final: 60, failed: 4, restFinal: 240, restFailed: 1 }).outlier, true);
    // 정상 명단(2.5%)에서 칸 3/50은 우연 (SND-03)
    const chance = isOutlierCell({ final: 50, failed: 3, restFinal: 250, restFailed: 6 });
    assert.equal(chance.eligible, true);
    assert.equal(chance.outlier, false);
    assert.ok((chance.pValue ?? 0) > 0.05);
    assert.equal(isOutlierCell({ final: 49, failed: 4, restFinal: 240, restFailed: 1 }).eligible, false);
    assert.equal(isOutlierCell({ final: 60, failed: 2, restFinal: 240, restFailed: 0 }).outlier, false);
    assert.equal(isOutlierCell({ final: 60, failed: 4, restFinal: 99, restFailed: 0 }).eligible, false);
    // 나머지 0%여도 바닥 0.5%로 비교한다
    assert.equal(isOutlierCell({ final: 60, failed: 4, restFinal: 300, restFailed: 0 }).restRateBp, 50);
});

// ── 명단 판정 (5-5 표, H13) ──

test("명단 199통 20실패 → 판정 보류 (30일도 199)", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 179, failed: 20 })] });
    assert.equal(pState(ev, 1)?.state, "insufficient");
});

test("명단 200통: 10실패 위험(경계 포함) · 9실패 주의 · 6실패 주의(경계) · 5실패 정상", () => {
    const states = [10, 9, 6, 5].map((f) => pState(evaluate({ buckets: [bucket(1, 10, { success: 200 - f, failed: f })] }), 1)?.state);
    assert.deepEqual(states, ["danger", "caution", "caution", "ok"]);
});

test("명단 200통 5실패 + SST7 40통 → 명단 정상, 발신 도메인 주의", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 195, failed: 5, senderSide: 40 })] });
    assert.equal(pState(ev, 1)?.state, "ok");
    assert.equal(ev.domains.find((d) => d.domain === "a.test")?.state, "caution");
});

test("명단 200통 5실패 + 5.7.26 dmarc 30통(발신 쪽) → 명단 정상, 1시간 안이면 폭주", () => {
    const burst: BurstRow[] = [{ senderDomain: "a.test", senderProfileId: 10, success: 20, failed: 0, dsnOnly: 0, senderSide: 30, nhnUnsub: 0, unknown: 0 }];
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 195, failed: 5, senderSide: 30 })], burst });
    assert.equal(pState(ev, 1)?.state, "ok");
    const d = ev.domains.find((x) => x.domain === "a.test");
    assert.equal(d?.burst, true);
    assert.equal(d?.state, "danger");
});

test("명단 확정 200 + 미확정 100 → 분모 200으로 판정, 미확정 33%", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 188, failed: 12, unknown: 100 })] });
    const p = pState(ev, 1);
    assert.equal(p?.state, "danger");
    assert.equal(p?.final, 200);
    assert.equal(p?.unconfirmedBp, 3333);
});

test("반송만: DSN_IN_RATE off면 빼고(dsn_only), on이면 분자·분모 (SND-02)", () => {
    const b = [bucket(1, 10, { success: 300, dsnOnly: 20 })];
    const off = pState(evaluate({ buckets: b }), 1);
    assert.equal(off?.state, "ok");
    assert.equal(off?.final, 300);
    assert.equal(off?.dsnOnly, 20);
    const on = pState(evaluate({ buckets: b, dsnInRate: true }), 1);
    assert.equal(on?.final, 320);
    assert.equal(on?.failedCount, 20);
    assert.equal(on?.state, "danger");
});

test("느린 명단: 7일 150통·30일 400통 6% → 위험 (30d, SND-17)", () => {
    const ev = evaluate({
        buckets: [bucket(1, 10, { success: 141, failed: 9 })],
        slow: [{ partitionId: 1, afterP: true, firstSentAt: null, success: 376, failed: 24, dsnOnly: 0 }],
    });
    const p = pState(ev, 1);
    assert.equal(p?.state, "danger");
    assert.equal(p?.evalWindow, "30d");
    assert.equal(p?.final, 400);
});

test("풀린 시각 뒤 발송만 센다 (SND-05): 하한 앞 묶음은 빼고 150통이면 판정 보류", () => {
    const released = new Date(NOW.getTime() - 3 * HOUR);
    const ev = evaluate({
        buckets: [
            bucket(1, 10, { success: 200, failed: 30 }, { afterP: false }),
            bucket(1, 10, { success: 150, failed: 0 }),
        ],
        partitions: [pinfo(1, { floorAt: released, heldOrReleasedRecently: true })],
    });
    const p = pState(ev, 1);
    assert.equal(p?.state, "insufficient");
    assert.equal(p?.final, 150);
    assert.equal(p?.windowStart.toISOString(), released.toISOString());
});

// ── 주소 판정 (5-4, H14) ──

/** 명단 pid: 주소 s가 sFinal 중 sFailed 실패, 다른 주소 둘이 나머지 */
function partitionWithSender(pid: number, s: number, sFinal: number, sFailed: number, restFinal: number, restFailed: number): HealthBucket[] {
    const half = Math.floor(restFinal / 2);
    return [
        bucket(pid, s, { success: sFinal - sFailed, failed: sFailed }),
        bucket(pid, 101, { success: half - restFailed, failed: restFailed }),
        bucket(pid, 102, { success: restFinal - half }),
    ];
}

test("주소 S: 명단 A 60/4, B 58/4, 나머지 0.4~0.5% → 주소 위험 (두 칸 p < 0.01)", () => {
    const ev = evaluate({ buckets: [...partitionWithSender(1, 10, 60, 4, 240, 1), ...partitionWithSender(2, 10, 58, 4, 240, 1)] });
    assert.equal(pState(ev, 1)?.state, "ok");
    assert.equal(pState(ev, 2)?.state, "ok");
    const s = sState(ev, 10);
    assert.equal(s?.state, "danger");
    assert.equal(s?.outlierCells.length, 2);
    assert.equal(sState(ev, 101)?.state === "danger", false);
});

test("주소 S: 명단 A 60/4, B 49/4 → 주소 주의 (B는 50통 미만이라 칸 아님)", () => {
    const ev = evaluate({ buckets: [...partitionWithSender(1, 10, 60, 4, 240, 1), ...partitionWithSender(2, 10, 49, 4, 240, 1)] });
    assert.equal(sState(ev, 10)?.state, "caution");
});

test("주소 S: 명단 A 60/2 → 셈 안 함", () => {
    const ev = evaluate({ buckets: [...partitionWithSender(1, 10, 60, 2, 240, 0), ...partitionWithSender(2, 10, 60, 2, 240, 0)] });
    assert.equal(sState(ev, 10)?.outlierCells.length, 0);
    assert.notEqual(sState(ev, 10)?.state, "danger");
});

test("정상 명단(2.5%) 두 개에서 칸 50/3 → 셈 안 함 (p ≈ 0.13, SND-03)", () => {
    const ev = evaluate({ buckets: [...partitionWithSender(1, 10, 50, 3, 250, 5), ...partitionWithSender(2, 10, 50, 3, 250, 5)] });
    assert.equal(pState(ev, 1)?.state, "ok");
    assert.equal(sState(ev, 10)?.outlierCells.length, 0);
    assert.notEqual(sState(ev, 10)?.state, "danger");
});

test("명단 3.5%(주의)에서 칸이 6% → 그 명단은 비교 칸(이항)에서 빼지만, 두 명단에서 함께 6%라 PRD 규칙으로 주소 위험 (F3)", () => {
    const ev = evaluate({ buckets: [...partitionWithSender(1, 10, 100, 6, 300, 8), ...partitionWithSender(2, 10, 100, 6, 300, 8)] });
    assert.equal(pState(ev, 1)?.state, "caution");
    assert.equal(sState(ev, 10)?.outlierCells.length, 0);
    assert.equal(sState(ev, 10)?.state, "danger");
    assert.equal(sState(ev, 10)?.dangerBy, "multi");
    assert.deepEqual(sState(ev, 10)?.highCells.map((c) => c.partitionId), [1, 2]);
});

test("PRD 주소 위험 (F3): 작은 명단 5개(각 100통·8%, 명단은 판정 보류)도 주소는 위험, 명단 하나만이면 아니다", () => {
    const five = evaluate({ buckets: [1, 2, 3, 4, 5].map((pid) => bucket(pid, 10, { success: 92, failed: 8 })) });
    assert.equal(pState(five, 1)?.state, "insufficient");
    assert.equal(sState(five, 10)?.state, "danger");
    assert.equal(sState(five, 10)?.dangerBy, "multi");
    assert.equal(sState(five, 10)?.highCells.length, 5);
    // 명단 하나만 높으면 명단 문제 — 주소는 위험이 아니다 (PRD 수용 기준 2)
    const one = evaluate({ buckets: [bucket(1, 10, { success: 188, failed: 12 }), bucket(2, 10, { success: 200 })] });
    assert.equal(pState(one, 1)?.state, "danger");
    assert.notEqual(sState(one, 10)?.state, "danger");
    // 칸 확정 합이 200통 미만이면 판정하지 않는다 (표본 하한 — 두 칸 50/3)
    const thin = evaluate({ buckets: [bucket(1, 10, { success: 47, failed: 3 }), bucket(2, 10, { success: 47, failed: 3 })] });
    assert.notEqual(sState(thin, 10)?.state, "danger");
    // 혼자 보내는 나쁜 명단 두 개(각 6.4%)지만 다른 명단 셋에서는 1% — 주소 전체 2.8%라 명단 탓, 주소는 위험 아님 (명단은 보류된다)
    const listFault = evaluate({
        buckets: [
            bucket(1, 10, { success: 206, failed: 14 }),
            bucket(2, 10, { success: 206, failed: 14 }),
            ...[3, 4, 5].map((pid) => bucket(pid, 10, { success: 297, failed: 3 })),
        ],
    });
    assert.equal(pState(listFault, 1)?.state, "danger");
    assert.equal(sState(listFault, 10)?.highCells.length, 2);
    assert.notEqual(sState(listFault, 10)?.state, "danger");
});

test("PRD 수용 기준 3 (F3): 명단 2개에서 함께 6% → 두 명단 보류 + 그 주소 멈춤 (enforce), 알림만 모드면 알림", () => {
    const buckets = [1, 2].flatMap((pid) => [bucket(pid, 10, { success: 282, failed: 18 })]);
    const ev = evaluate({ buckets });
    assert.equal(sState(ev, 10)?.state, "danger");
    const plan = planActions({ mode: "enforce", now: NOW, evaluation: ev, senders: [sinfo(10)], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    assert.deepEqual(plan.events.filter((e) => e.entityType === "partition").map((e) => e.action), ["hold", "hold"]);
    const sEv = plan.events.find((e) => e.entityType === "sender" && e.kind === "danger");
    assert.equal(sEv?.action, "pause");
    // 주소가 위험이면 주된 발신(danger_with) 알림은 따로 내지 않는다
    assert.equal(plan.events.some((e) => e.kind === "danger_with"), false);
    const alertPlan = planActions({ mode: "alert", now: NOW, evaluation: ev, senders: [sinfo(10)], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    assert.equal(alertPlan.events.find((e) => e.entityType === "sender")?.wouldAction, "pause");
});

test("보류 중·최근 7일 보류/풀림 명단은 칸에서 뺀다 (SND-04)", () => {
    const buckets = [...partitionWithSender(1, 10, 60, 4, 240, 1), ...partitionWithSender(2, 10, 58, 4, 240, 1)];
    const held = evaluate({ buckets, partitions: [pinfo(1, { activeHoldId: 7 }), pinfo(2)] });
    assert.equal(sState(held, 10)?.state === "danger", false);
    const recent = evaluate({ buckets, partitions: [pinfo(1, { heldOrReleasedRecently: true }), pinfo(2, { heldOrReleasedRecently: true })] });
    assert.equal(sState(recent, 10)?.outlierCells.length, 0);
});

test("명단 하한은 그 명단의 주소 칸에도 걸린다 (SND-04)", () => {
    const buckets = [
        bucket(1, 10, { success: 56, failed: 4 }, { afterP: false }),
        bucket(1, 101, { success: 119, failed: 1 }),
        bucket(1, 102, { success: 120 }),
        ...partitionWithSender(2, 10, 58, 4, 240, 1),
    ];
    const ev = evaluate({ buckets });
    assert.equal(sState(ev, 10)?.outlierCells.length, 1);
    assert.equal(sState(ev, 10)?.state, "caution");
});

test("주된 발신(60%) 두 위험 명단, 주소 자신은 낮음 → danger_with 알림, 멈춤 없음 (SND-07). 10%면 알림 없음", () => {
    // 주소 10은 명단의 60%를 보냈지만 자기 실패율은 1.5% — 실패는 다른 주소(101) 몫. 주소 10은 위험이 아니라 알림만
    const mk = (share: number) => {
        const sFinal = Math.round(220 * share);
        return [1, 2].flatMap((pid) => [
            bucket(pid, 10, { success: sFinal - 2, failed: 2 }),
            bucket(pid, 101, { success: 220 - sFinal - 10, failed: 10 }),
        ]);
    };
    const ev = evaluate({ buckets: mk(0.6) });
    assert.notEqual(sState(ev, 10)?.state, "danger");
    assert.equal(pState(ev, 1)?.state, "danger");
    assert.deepEqual(sState(ev, 10)?.primaryOfDanger, [1, 2]);
    const plan = planActions({ mode: "enforce", now: NOW, evaluation: ev, senders: [sinfo(10), sinfo(101)], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    assert.deepEqual(plan.events.filter((e) => e.entityType === "partition").map((e) => e.action), ["hold", "hold"]);
    const withEv = plan.events.find((e) => e.kind === "danger_with");
    assert.equal(withEv?.entityId, 10);
    assert.equal(withEv?.action, "none");
    assert.equal(plan.events.some((e) => e.entityType === "sender" && e.action === "pause"), false);

    const ev10 = evaluate({ buckets: mk(0.1) });
    const plan10 = planActions({ mode: "enforce", now: NOW, evaluation: ev10, senders: [sinfo(10), sinfo(101)], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    assert.equal(plan10.events.some((e) => e.kind === "danger_with" && e.entityId === 10), false);
});

test("혼자 보내는 템플릿 명단은 칸이 없다 — 기본 주소가 명단 비율을 따라 위험이 되지 않는다 (SND-08)", () => {
    const ev = evaluate({
        buckets: [bucket(1, 1, { success: 211, failed: 9 }), bucket(2, 1, { success: 211, failed: 9 })],
        senders: [sinfo(1, { isDefault: true })],
    });
    assert.equal(pState(ev, 1)?.state, "caution");
    assert.notEqual(sState(ev, 1)?.state, "danger");
});

// ── 도메인 (H15) ──

test("발신 쪽 실패 폭주: 3통·20% 또는 10통", () => {
    assert.equal(isAuthBurst(6, 20), true); // 6/26 = 23%
    assert.equal(isAuthBurst(2, 50), false);
    assert.equal(isAuthBurst(3, 20), false); // 3/23 = 13%
    assert.equal(isAuthBurst(10, 1000), true);
});

// ── 관문·조치 (6절, H17~H24) ──

test("resolveSendHealthConfig: 네 값, 모르는 값·빈 값은 dry_run (H17)", () => {
    assert.equal(resolveSendHealthConfig({}).mode, "dry_run");
    assert.equal(resolveSendHealthConfig({ SEND_HEALTH_MODE: "Enforce" }).mode, "enforce");
    assert.equal(resolveSendHealthConfig({ SEND_HEALTH_MODE: "alert" }).mode, "alert");
    assert.equal(resolveSendHealthConfig({ SEND_HEALTH_MODE: "off" }).mode, "off");
    assert.equal(resolveSendHealthConfig({ SEND_HEALTH_MODE: "enforec" }).mode, "dry_run");
    const c = resolveSendHealthConfig({ SEND_HEALTH_ALERT_ONLY_PARTITION_IDS: "3, x, 5,3", SEND_HEALTH_DSN_IN_RATE: "on", SEND_HEALTH_REPORT_HOUR: "30" });
    assert.deepEqual(c.alertOnlyPartitionIds, [3, 5]);
    assert.equal(c.dsnInRate, true);
    assert.equal(c.reportHour, 23);
    assert.equal(c.maxAutoPausePerDay, 5);
    assert.equal(c.maxAuthPauseDomainsPerDay, 10);
});

test("syncGate: 정체·키 오류·처음 채우기 중·정상", () => {
    const ok = { lastOkAt: new Date(NOW.getTime() - 10 * 60 * 1000), lastErrorCode: null, initialDoneAt: NOW };
    assert.equal(syncGate(ok, NOW), null);
    assert.equal(syncGate({ ...ok, lastOkAt: new Date(NOW.getTime() - 31 * 60 * 1000) }, NOW), "sync_stale");
    assert.equal(syncGate({ ...ok, lastErrorCode: "auth" }, NOW), "sync_stale");
    assert.equal(syncGate({ ...ok, initialDoneAt: null }, NOW), "sync_initial");
    assert.equal(syncGate(null, NOW), "sync_initial");
});

const dangerP1 = () => evaluate({ buckets: [bucket(1, 10, { success: 206, failed: 14 })] });

test("planActions: dry_run·alert은 조치 없이 '했을 조치'만 (H18·H19)", () => {
    for (const mode of ["dry_run", "alert"] as const) {
        const plan = planActions({ mode, now: NOW, evaluation: dangerP1(), senders: [sinfo(10)], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
        assert.equal(plan.events.length, 1);
        assert.equal(plan.events[0].action, "none");
        assert.equal(plan.events[0].actionNote, "mode");
        assert.equal(plan.events[0].wouldAction, "hold");
        assert.ok(plan.events[0].dedupeKey.includes(`:${mode}:`));
    }
});

test("planActions enforce: 명단 보류, 관문·미확정·예외면 알림만 (H20)", () => {
    const base = { mode: "enforce" as const, now: NOW, senders: [sinfo(10)], autoPauseLeft: 5, authDomainsLeft: 10 };
    assert.equal(planActions({ ...base, evaluation: dangerP1(), gate: null }).events[0].action, "hold");
    assert.equal(planActions({ ...base, evaluation: dangerP1(), gate: "sync_stale" }).events[0].actionNote, "sync_stale");
    assert.equal(planActions({ ...base, evaluation: dangerP1(), gate: "sync_initial" }).events[0].actionNote, "sync_initial");
    const unconfirmed = evaluate({ buckets: [bucket(1, 10, { success: 188, failed: 12, unknown: 100 })] });
    assert.equal(planActions({ ...base, evaluation: unconfirmed, gate: null }).events[0].actionNote, "unconfirmed_high");
    const optOut = evaluate({ buckets: [bucket(1, 10, { success: 206, failed: 14 })], partitions: [pinfo(1, { alertOnly: true })] });
    assert.equal(planActions({ ...base, evaluation: optOut, gate: null }).events[0].actionNote, "opt_out");
    const held = evaluate({ buckets: [bucket(1, 10, { success: 206, failed: 14 })], partitions: [pinfo(1, { activeHoldId: 3 })] });
    assert.equal(planActions({ ...base, evaluation: held, gate: null }).events.length, 0);
});

function dangerSenders(ids: number[]) {
    return ids.flatMap((s, i) => [...partitionWithSender(100 + i * 2, s, 60, 4, 240, 1), ...partitionWithSender(101 + i * 2, s, 58, 4, 240, 1)]);
}

test("planActions enforce: 주소 멈춤 — 기본 주소·알림만·손으로 멈춤·프로필 없음은 알림만 (H23)", () => {
    const ev = evaluate({
        buckets: dangerSenders([1, 2, 3, 4]),
        senders: [sinfo(1), sinfo(2, { isDefault: true }), sinfo(3, { healthAction: "alert" }), sinfo(4, { isPaused: true, pausedSource: "manual" }), sinfo(101), sinfo(102)],
    });
    const plan = planActions({ mode: "enforce", now: NOW, evaluation: ev, senders: ev.senders.map((s) => sinfo(s.profileId, s.profileId === 2 ? { isDefault: true } : s.profileId === 3 ? { healthAction: "alert" } : s.profileId === 4 ? { isPaused: true, pausedSource: "manual" } : {})), gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    const by = new Map(plan.events.filter((e) => e.entityType === "sender").map((e) => [e.entityId, [e.action, e.actionNote]]));
    assert.deepEqual(by.get(1), ["pause", null]);
    assert.deepEqual(by.get(2), ["none", "default_sender"]);
    assert.deepEqual(by.get(3), ["none", "opt_out"]);
    assert.deepEqual(by.get(4), ["none", "already"]);
});

test("planActions: 자동 멈춘 주소는 다시 판정하지 않는다, 하루 상한을 넘으면 cap (H24·H27)", () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const ev = evaluate({ buckets: dangerSenders(ids), senders: [...ids.map((i) => sinfo(i)), sinfo(101), sinfo(102)] });
    const plan = planActions({ mode: "enforce", now: NOW, evaluation: ev, senders: [...ids.map((i) => sinfo(i)), sinfo(101), sinfo(102)], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    const senderEvents = plan.events.filter((e) => e.entityType === "sender" && e.kind === "danger");
    assert.equal(senderEvents.filter((e) => e.action === "pause").length, 5);
    assert.deepEqual(plan.cappedSenders, [6]);

    const paused = evaluate({ buckets: dangerSenders([1]), senders: [sinfo(1, { isPaused: true, pausedSource: "auto" }), sinfo(101), sinfo(102)] });
    assert.equal(sState(paused, 1)?.autoPaused, true);
    const plan2 = planActions({ mode: "enforce", now: NOW, evaluation: paused, senders: [sinfo(1, { isPaused: true, pausedSource: "auto" })], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    assert.equal(plan2.events.length, 0);
});

test("planActions: 발신 쪽 실패 폭주 → 그 도메인 주소 멈춤(기본 주소 제외), 도메인 상한 따로, 미확정 관문은 안 본다 (H15·H24)", () => {
    const burst: BurstRow[] = ["x.test", "y.test"].map((d, i) => ({ senderDomain: d, senderProfileId: 20 + i, success: 20, failed: 0, dsnOnly: 0, senderSide: 6, nhnUnsub: 0, unknown: 50 }));
    const senders = [sinfo(20, { domain: "x.test", email: "a@x.test" }), sinfo(30, { domain: "x.test", email: "cs@x.test", isDefault: true }), sinfo(21, { domain: "y.test", email: "a@y.test" })];
    const ev = evaluate({ buckets: [], burst, senders });
    const plan = planActions({ mode: "enforce", now: NOW, evaluation: ev, senders, gate: null, autoPauseLeft: 0, authDomainsLeft: 1 });
    const x = plan.events.find((e) => e.entityKey === "x.test");
    const y = plan.events.find((e) => e.entityKey === "y.test");
    assert.equal(x?.action, "pause");
    assert.deepEqual(x?.pauseProfileIds, [20]);
    assert.deepEqual(x?.skippedProfileIds, [30]);
    assert.equal(y?.actionNote, "cap_auth");
    assert.deepEqual(plan.cappedDomains, ["y.test"]);
    const gated = planActions({ mode: "enforce", now: NOW, evaluation: ev, senders, gate: "sync_stale", autoPauseLeft: 0, authDomainsLeft: 10 });
    assert.equal(gated.events.every((e) => e.actionNote === "sync_stale"), true);
});

// ── 사건 키 (7-1, H27) ──

test("dedupeKey: 날짜가 바뀌어도 같고, 1%p 넘게 나빠지면·하한이 바뀌면 새 키", () => {
    const k1 = dedupeKey.partitionDanger(1, "alert", null, 640);
    assert.equal(k1, "danger:p:1:alert:0:e0:6");
    assert.equal(dedupeKey.partitionDanger(1, "alert", null, 690), k1);
    assert.notEqual(dedupeKey.partitionDanger(1, "alert", null, 760), k1);
    assert.notEqual(dedupeKey.partitionDanger(1, "enforce", null, 640), k1);
    assert.notEqual(dedupeKey.partitionDanger(1, "alert", new Date(NOW.getTime() - HOUR), 640), k1);
    assert.equal(rateBucket(null), 0);
    assert.equal(dedupeKey.senderWith(10, "alert", [3, 1, 2]), "danger_with:s:10:alert:1,2,3");
    const many = dedupeKey.senderWith(10, "alert", Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(many.endsWith("+2"));
    assert.equal(dedupeKey.report(NOW), "report:2026-10-12");
});

test("위험 구간 (F7·OPS-4): 같은 구간에서 좋아지면 다시 알리지 않고, 회복 뒤 다시 위험이면 새 사건", () => {
    const ep = new Date(NOW.getTime() - 3 * 24 * HOUR);
    const first = dedupeKey.partitionDanger(1, "alert", null, 720, { startedAt: ep, existingKeys: new Set() });
    assert.equal(first, `danger:p:1:alert:0:e${ep.getTime()}:7`);
    const existing = new Set([first]);
    // 7.2% → 6.4%: 같은 구간에서 좋아짐 → 이미 있는 키 (새 사건·알림 없음)
    assert.equal(dedupeKey.partitionDanger(1, "alert", null, 640, { startedAt: ep, existingKeys: existing }), first);
    // 8.1%: 알린 칸보다 나빠짐 → 새 키
    assert.equal(dedupeKey.partitionDanger(1, "alert", null, 810, { startedAt: ep, existingKeys: existing }), `danger:p:1:alert:0:e${ep.getTime()}:8`);
    // 회복 뒤 새 구간 → 같은 칸이어도 새 키
    const later = new Date(NOW.getTime());
    assert.notEqual(dedupeKey.partitionDanger(1, "alert", null, 720, { startedAt: later, existingKeys: existing }), first);
    // 모드가 다르면 다른 키 (enforce로 바꾸면 조치한다)
    assert.notEqual(dedupeKey.partitionDanger(1, "enforce", null, 720, { startedAt: ep, existingKeys: existing }), first);

    // 구간 시작: 지난 회차도 위험이면 이어짐, 위험에서 벗어난 지 하루가 안 됐으면 이어짐, 2주 정상이었으면 새 구간
    assert.equal(dangerEpisodeStart({ state: "danger", episodeAt: ep, lastDangerAt: NOW }, NOW).getTime(), ep.getTime());
    assert.equal(dangerEpisodeStart({ state: "caution", episodeAt: ep, lastDangerAt: new Date(NOW.getTime() - 2 * HOUR) }, NOW).getTime(), ep.getTime());
    assert.equal(dangerEpisodeStart({ state: "ok", episodeAt: ep, lastDangerAt: new Date(NOW.getTime() - 14 * 24 * HOUR) }, NOW).getTime(), NOW.getTime());
    assert.equal(dangerEpisodeStart(null, NOW).getTime(), NOW.getTime());

    // planActions: 구간·이미 남긴 키를 받아 같은 키를 만든다
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 186, failed: 14 })] });
    const plan = planActions({
        mode: "alert",
        now: NOW,
        evaluation: ev,
        senders: [sinfo(10)],
        gate: null,
        autoPauseLeft: 5,
        authDomainsLeft: 10,
        episodes: { partitions: new Map([[1, ep]]), senders: new Map() },
        existingDangerKeys: existing,
    });
    assert.equal(plan.events.find((e) => e.entityType === "partition")?.dedupeKey, first);
});

test("senderDangerText: 사업 스페이스 글은 그 사업 명단만, 다른 사업 명단은 숫자만 (RH-SEC-4)", () => {
    const buckets = [1, 2, 3].flatMap((pid) => [bucket(pid, 10, { success: 92, failed: 8 })]);
    const ev = evaluate({ buckets, partitions: [pinfo(1, { workspaceId: 1 }), pinfo(2, { workspaceId: 1 }), pinfo(3, { workspaceId: 2 })] });
    const s = sState(ev, 10)!;
    assert.equal(s.dangerBy, "multi");
    const base = {
        s,
        mode: "alert" as const,
        action: "none" as const,
        actionNote: "mode" as const,
        partitionNames: new Map([[1, "W1 명단 가"], [2, "W1 명단 나"], [3, "W2 비밀 명단"]]),
        rulePools: [],
        warmup: false,
        baseUrl: "https://sendb.kr",
    };
    const ops = senderDangerText(base);
    assert.ok(ops.includes("W2 비밀 명단"));
    assert.ok(ops.includes("명단 3개에서 함께 실패율 5% 이상"));
    const partitionWorkspace = new Map([[1, 1], [2, 1], [3, 2]]);
    const w1 = senderDangerText({ ...base, scope: { workspaceId: 1, partitionWorkspace } });
    assert.ok(w1.includes("W1 명단 가"));
    assert.ok(!w1.includes("W2 비밀 명단"));
    assert.ok(w1.includes("다른 사업 명단 1개"));
    const w2 = senderDangerText({ ...base, scope: { workspaceId: 2, partitionWorkspace } });
    assert.ok(w2.includes("W2 비밀 명단"));
    assert.ok(!w2.includes("W1 명단"));
    assert.ok(w2.includes("다른 사업 명단 2개"));
});

test("resolveSendHealthConfig 조직 범위 (OPS-2): * = 전부, 조직 id = 그 조직만, 비면 회신·깊이 알림 워크스페이스의 조직", () => {
    assert.deepEqual(resolveSendHealthConfig({ SEND_HEALTH_ORG_IDS: "*" }).orgScope, { kind: "all" });
    assert.deepEqual(resolveSendHealthConfig({ SEND_HEALTH_ORG_IDS: "ALL" }).orgScope, { kind: "all" });
    const id = "00000000-0000-4000-8000-00000000000A";
    assert.deepEqual(resolveSendHealthConfig({ SEND_HEALTH_ORG_IDS: `${id}, 잘못, ${id}` }).orgScope, { kind: "ids", orgIds: [id.toLowerCase()] });
    assert.deepEqual(resolveSendHealthConfig({ REPLY_WORKSPACE_IDS: "8,9", DEEP_ALERT_WORKSPACE_IDS: "9,10" }).orgScope, { kind: "default", workspaceIds: [8, 9, 10] });
    assert.deepEqual(resolveSendHealthConfig({}).orgScope, { kind: "default", workspaceIds: [] });
});

test("isQuietHour: KST 22~08시 (H19)", () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 12, h - 9, m));
    assert.equal(isQuietHour(at(22)), true);
    assert.equal(isQuietHour(at(7, 59)), true);
    assert.equal(isQuietHour(at(8)), false);
    assert.equal(isQuietHour(at(21, 59)), false);
    assert.equal(isReportDue(at(8, 59), 9), false);
    assert.equal(isReportDue(at(9, 1), 9), true);
});

test("kstDayStart: KST 0시", () => {
    const d = kstDayStart(new Date("2026-10-11T16:00:00Z")); // KST 10/12 01:00
    assert.equal(d.date, "2026-10-12");
    assert.equal(d.start.toISOString(), "2026-10-11T15:00:00.000Z");
});

// ── 받는 곳·글 (7절, H28·H29) ──

test("resolveHealthWebhook: 운영 / 사업(SEND_HEALTH → DEEP_ALERT), 공통 깊이 알림은 쓰지 않는다, https만", () => {
    const env = {
        SEND_HEALTH_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/OPS/messages?key=k",
        SEND_HEALTH_WEBHOOK_URL_1: "https://chat.googleapis.com/v1/spaces/W1/messages?key=k",
        DEEP_ALERT_WEBHOOK_URL_2: "https://chat.googleapis.com/v1/spaces/D2/messages?key=k",
        DEEP_ALERT_WEBHOOK_URL: "https://chat.googleapis.com/v1/spaces/COMMON/messages?key=k",
        SEND_HEALTH_WEBHOOK_URL_4: "http://insecure",
    };
    assert.ok(resolveHealthWebhook(env, "ops")?.includes("OPS"));
    assert.ok(resolveHealthWebhook(env, 1)?.includes("W1"));
    assert.ok(resolveHealthWebhook(env, 2)?.includes("D2"));
    assert.equal(resolveHealthWebhook(env, 3), null);
    assert.equal(resolveHealthWebhook(env, 4), null);
    assert.equal(resolveHealthWebhook({}, "ops"), null);
});

test("partitionDangerText: 보류 글 — 숫자·사유·명단 쪽 진단, 받는 주소 없음", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 100, failed: 7 }), bucket(1, 11, { success: 99, failed: 6, dsnOnly: 4 })] });
    const p = pState(ev, 1)!;
    const text = partitionDangerText({
        p,
        workspaceName: "디하",
        mode: "enforce",
        action: "hold",
        actionNote: null,
        reasons: [
            { status: "5.1.1", count: 9 },
            { status: "5.1.2", count: 3 },
            { status: null, count: 1 },
            { status: "5.2.2", count: 1 },
        ],
        heldQueue: 1240,
        senderRates: [
            { email: "cs@a.test", rateBp: 650, final: 107 },
            { email: "cs2@a.test", rateBp: 571, final: 105 },
        ],
        baseUrl: "https://sendb.kr",
    });
    assert.ok(text.startsWith("[발송 위험 · 명단 보류] 디하 › P1"));
    assert.ok(text.includes("결과가 나온 212통 중 실패 13통 (6.1%)"));
    assert.ok(text.includes("받는 주소 없음 (5.1.1) 9통"), text);
    assert.ok(text.includes("기타 1통"));
    assert.ok(text.includes("대기 1,240통"));
    assert.ok(text.includes("명단 쪽 문제로 보입니다"));
    assert.ok(text.includes("반송 안내(참고, 실패율에는 아직 안 넣음): 4통"));
    assert.ok(text.includes("https://sendb.kr/email#send-health"));
});

test("senderDangerText·authBurstText·releaseText·manualHoldMessage", () => {
    const ev = evaluate({ buckets: [...partitionWithSender(1, 10, 60, 4, 240, 1), ...partitionWithSender(2, 10, 58, 4, 240, 1)], senders: [sinfo(10, { email: "cs@abc-mail.test" }), sinfo(101), sinfo(102)] });
    const s = sState(ev, 10)!;
    const st = senderDangerText({
        s,
        mode: "enforce",
        action: "pause",
        actionNote: null,
        partitionNames: new Map([[1, "수출바우처 10월"], [2, "제조 리스트 B"]]),
        rulePools: [{ name: "디하 AI 첫 메일", size: 20 }],
        warmup: true,
        baseUrl: "https://sendb.kr",
    });
    assert.ok(st.startsWith("[발송 위험 · 주소 멈춤] cs@abc-mail.test"));
    assert.ok(st.includes("수출바우처 10월 6.7% (결과 60통 중 실패 4통)"));
    assert.ok(st.includes("묶음 20개 중 19개"));
    const def = senderDangerText({ s, mode: "enforce", action: "none", actionNote: "default_sender", partitionNames: new Map(), rulePools: [], warmup: false, baseUrl: "" });
    assert.ok(def.includes("조직 기본 주소입니다"));

    const burst = evaluate({ burst: [{ senderDomain: "x-mail.test", senderProfileId: 1, success: 20, failed: 0, dsnOnly: 0, senderSide: 6, nhnUnsub: 0, unknown: 0 }] });
    const bt = authBurstText({
        d: burst.domains[0],
        mode: "enforce",
        action: "pause",
        actionNote: null,
        reasons: [{ status: "5.7.26", count: 5 }, { status: "SST7", count: 1 }],
        pausedEmails: ["a@x-mail.test", "b@x-mail.test"],
        skippedEmails: ["cs@x-mail.test"],
        defaultEmails: ["cs@x-mail.test"],
    });
    assert.ok(bt.includes("최근 1시간 발신 인증 실패 6통 (발송 26통 중 23.1%)"));
    assert.ok(bt.includes("주소 2개를 멈췄습니다 (기본 주소 cs@x-mail.test은 알림만)"));

    assert.ok(releaseText({ kind: "hold", name: "P1", actorName: "김이삭", note: "명단 정리함", revived: 75 }).includes('김이삭님이 보류를 풀었습니다 (메모: "명단 정리함").'));
    assert.ok(releaseText({ kind: "sender", name: "cs@a.test", actorName: null, note: null, todayCap: 35, warmupDay: 6 }).includes("오늘 한도 35통 (웜업 6일째)"));
    assert.ok(manualHoldMessage({ partitionName: "P1", reasonText: "최근 7일 확정 220통 중 실패 14통 (6.4%)", heldAt: NOW }).startsWith("이 명단은 발송 실패가 많아 보류 중입니다 (P1,"));
});

test("batchAlertText: 한 통에 묶고 3,800자에서 '외 N건'", () => {
    const short = batchAlertText({ orgName: "매치스플랜", blocks: ["가", "나"], baseUrl: "https://sendb.kr" });
    assert.ok(short.startsWith("[발송 건강] 매치스플랜 — 알림 2건"));
    // 화면 링크는 늘 끝에 (HB-9)
    assert.ok(short.endsWith("자세히: https://sendb.kr/email#send-health"));
    const long = batchAlertText({ orgName: "o", blocks: Array.from({ length: 40 }, (_, i) => `${i} ${"x".repeat(200)}`), baseUrl: "https://sendb.kr" });
    assert.ok(long.length <= 3800);
    assert.match(long, /외 \d+건 — 화면에서 보기/);
});

test("dailyReportText·hasReportableItems (H29)", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 206, failed: 14, dsnOnly: 9 }), bucket(2, 10, { success: 203, failed: 7 }), bucket(3, 10, { success: 100 })] });
    const text = dailyReportText({
        orgName: "매치스플랜",
        scopeLabel: null,
        now: new Date("2026-10-12T00:00:00Z"),
        mode: "enforce",
        dsnInRate: false,
        evaluation: ev,
        partitionNames: new Map([[1, "P1"], [2, "P2"], [3, "P3"]]),
        senderEmails: new Map([[10, "cs@a.test"]]),
        continuing: [{ label: "명단 P1", rate: "6.4%" }],
        holds: [{ name: "P1", heldAt: NOW, queued: 1240 }],
        autoPaused: [],
        dsn: { unpaired: 0, different: 1, complaints: 0 },
        sync: { lastOkAt: NOW, cursor: NOW, unconfirmedOld: 3, unpaired: 0, lastErrorCode: null, skippedWindowsTotal: 4, skippedWindowsLastAt: NOW },
        reply: { lastSuccessAt: NOW, mode: "on", replies: 4, bounces: 9 },
        nhnUnsub: 2,
        linkUnsub: 5,
    });
    assert.ok(text.startsWith("[발송 건강 · 10/12(월) 09:00] 매치스플랜"));
    assert.ok(text.includes("위험: 명단 1"));
    assert.ok(text.includes("주의: 명단 1"));
    assert.ok(text.includes("발송 보류·멈춤 중: P1"));
    assert.ok(text.includes("반송 안내(실패율에 아직 안 넣음)"));
    assert.ok(text.includes("회신 읽기 (켜짐): 마지막 성공"));
    assert.ok(text.includes("발송 건강 설정: 알림 + 위험한 명단·주소 자동 멈춤"));
    assert.ok(text.includes("결과를 주지 않아 건너뛴 구간 4개"));
    // 개발 말·설정값 이름은 싣지 않는다 (구글 챗 QA N5)
    assert.ok(!/짝 없는|받는 사람 다른|읽은 데까지|못 맞춘|\(enforce\)|모드 on/.test(text), text);
    // 목록 줄은 다른 알림과 같은 글머리표 "• " — 앞 공백 " - "는 쓰지 않는다 (N7)
    assert.ok(text.split("\n").some((l) => l.startsWith("• P2 ")), text);
    assert.ok(!text.split("\n").some((l) => /^\s+-\s/.test(l)), text);
    // 결과 확인이 한 번도 돌지 않았으면 그 줄을 싣는다 (OPS-8)
    const never = dailyReportText({
        orgName: "매치스플랜",
        scopeLabel: null,
        now: NOW,
        mode: "enforce",
        dsnInRate: false,
        evaluation: ev,
        partitionNames: new Map(),
        senderEmails: new Map(),
        continuing: [],
        holds: [],
        autoPaused: [],
        dsn: { unpaired: 0, different: 0, complaints: 0 },
        sync: null,
        syncNeverRan: true,
        reply: null,
        nhnUnsub: 0,
        linkUnsub: 0,
    });
    assert.ok(never.includes("NHN 결과 확인: 한 번도 돌지 않음 — 결과 확인 정기 작업(status-sync) 등록이 필요합니다"));
    assert.equal(hasReportableItems(ev, 0, 0), true);
    assert.equal(hasReportableItems(evaluate({ buckets: [bucket(3, 10, { success: 100 })] }), 0, 0), false);
});

// ── 구글 챗 QA (HB·HS·HD·HR) ──

test("사용자 값(명단·사업·조직 이름, 메모)은 멘션·링크·꾸밈·가짜 줄이 되지 않는다 (HB-1·HS-2·HD-01·HR-1·HR-2)", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 100, failed: 7 }), bucket(1, 11, { success: 99, failed: 6 })] });
    const p = { ...pState(ev, 1)!, name: "<users/all> 긴급 명단 *필독*\n[발송 건강 · 풀림] 가짜 줄" };
    const text = partitionDangerText({
        p,
        workspaceName: "<https://evil.test/phish|풀기> 사업",
        mode: "alert",
        action: "none",
        actionNote: "mode",
        reasons: [],
        heldQueue: null,
        senderRates: [],
        baseUrl: "https://sendb.kr",
    });
    const head = text.split("\n")[0];
    assert.ok(!text.includes("<users/"), text);
    assert.ok(!/<https?:/.test(text), text);
    assert.ok(!head.includes("*필독*"), head);
    assert.match(head, /‹hxxps:\/\/evil\.test\/phish\|풀기› 사업 › ‹users\/all› 긴급 명단 ＊필독＊ \[발송 건강 · 풀림\] 가짜 줄/);
    // 가짜 줄이 따로 생기지 않는다
    assert.ok(!text.split("\n").some((l) => l.startsWith("[발송 건강 · 풀림]")));

    const sync = syncAlertText({ cause: "auth", orgName: "QA5 <users/all> *굵게* <https://evil.example/reset|NHN 키 다시 넣기>", lastOkAt: null, lastError: null });
    assert.ok(!sync.includes("<users/") && !sync.includes("<https"), sync);
    const batch = batchAlertText({ orgName: "*굵은* _회사_ <b>주식회사</b>", blocks: ["가"], baseUrl: "https://sendb.kr" });
    assert.match(batch.split("\n")[0], /＊굵은＊ ＿회사＿ ‹b›주식회사‹\/b›/);

    const rel = releaseText({
        kind: "hold",
        name: "P1",
        actorName: "<users/all> *대표*",
        note: "<users/all> 풀었어요\n\n[발송 위험 · 명단 보류] 가짜\n풀기(관리자): https://evil.test/email#send-health",
        revived: 0,
    });
    assert.ok(!rel.includes("<users/"), rel);
    assert.ok(!rel.includes("https://evil.test"), rel);
    assert.equal(rel.split("\n").length, 1, rel);
});

test("releaseText: 이름 없으면 '관리자가', 기다리던 메일 0이면 그 문장 없음, 메모는 코드 포인트로 자르고 표시, 어느 사업인지·링크 (HR-7·HR-8·HR-9·HR-10)", () => {
    const t = releaseText({ kind: "hold", name: "수출바우처 10월", actorName: null, note: null, revived: 0, orgName: "매치스플랜", workspaceName: "디하", baseUrl: "https://sendb.kr" });
    assert.equal(
        t,
        "[발송 건강 · 풀림] 매치스플랜 · 디하 › 명단 수출바우처 10월 — 관리자가 보류를 풀었습니다. 앞으로 보내는 메일만 보고 다시 살핍니다.\n자세히: https://sendb.kr/email#send-health"
    );
    assert.ok(releaseText({ kind: "hold", name: "P", actorName: null, note: null, revived: 75 }).includes("기다리던 메일 75통이 원래 순서대로 다시 나갑니다."));
    const long = releaseText({ kind: "hold", name: "P", actorName: "김", note: "가".repeat(199) + "😀" + "끝", revived: 0 });
    assert.ok(long.includes("가".repeat(199) + "😀…"), long);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(long));
    const settings = releaseText({ kind: "sender", name: "cs@a.test", actorName: "김", note: null, via: "settings" });
    assert.ok(settings.includes("김님이 자동 멈춤을 풀었습니다 (발신 주소 설정에서 정지를 끔)."), settings);
    assert.ok(!settings.includes("메모"));
});

test("batchAlertText: 긴 블록 뒤의 짧은 블록도 담고, 너무 긴 블록은 줄 단위로 자르며, 더 나빠짐을 머리에 센다 (HB-4·HB-8)", () => {
    const huge = ["[발송 위험 · 상한] 주소 150개", ...Array.from({ length: 200 }, (_, i) => `줄 ${i} ${"x".repeat(30)}`)].join("\n");
    const text = batchAlertText({ orgName: "o", blocks: ["[발송 위험 · 명단] 짧은 블록 1", huge, "[발송 위험 · 명단] 짧은 블록 2"], baseUrl: "https://sendb.kr", worse: [false, false, true] });
    assert.ok(text.length <= 3800, String(text.length));
    assert.ok(text.includes("짧은 블록 2"), "긴 블록 뒤의 짧은 블록이 빠졌다");
    assert.ok(text.includes("[발송 위험 · 상한] 주소 150개"));
    assert.ok(text.includes("…(나머지는 화면에서 보기)"));
    assert.ok(text.startsWith("[발송 건강] o — 알림 3건 (새로 생긴 일 2 · 더 나빠진 일 1)"));
});

test("capText: 주소는 10개까지, 나머지는 수만 (HB-4)", () => {
    const emails = Array.from({ length: 150 }, (_, i) => `qa${i}@send-qa.test`);
    const t = capText({ senderEmails: emails, domains: [], maxPause: 0, maxDomains: 10 });
    assert.ok(t.length < 600, String(t.length));
    assert.ok(t.includes("qa9@send-qa.test 외 140개"));
});

test("partitionDangerText: 더 나빠짐 표시, 같은 실패율은 '모두 6.0%', 이유는 풀이가 먼저 (HB-8·HB-11)", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 207, failed: 13 })] });
    const p = pState(ev, 1)!;
    const text = partitionDangerText({
        p,
        workspaceName: null,
        mode: "alert",
        action: "none",
        actionNote: "mode",
        reasons: [{ status: "5.1.1", count: 9 }],
        heldQueue: null,
        senderRates: [
            { email: "a@x.test", rateBp: 600, final: 100 },
            { email: "b@x.test", rateBp: 600, final: 120 },
        ],
        baseUrl: "https://sendb.kr",
        worsenedFromBucket: 5,
    });
    assert.match(text.split("\n")[0], /— 더 나빠짐 \(지난 알림 5%대 → 지금 5\.9%\)$/);
    assert.ok(text.includes("실패율은 모두 6.0%로 비슷합니다"));
    assert.ok(text.includes("실패 이유: 받는 주소 없음 (5.1.1) 9통"));
    assert.ok(text.includes("조치: 없음 — 지금은 알림만 보내는 단계라 자동 멈춤은 꺼져 있습니다"));
});

test("planActions: 같은 구간에서 더 나빠진 사건은 지난 칸을 알고, 발신 인증 폭주는 그 주소를 쓰는 사업 스페이스에도 (HB-8·HB-13)", () => {
    const ep = new Date(NOW.getTime() - 3 * 24 * HOUR);
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 203, failed: 17 })], partitions: [pinfo(1, { workspaceId: 7 })] });
    const first = dedupeKey.partitionDanger(1, "alert", null, 640, { startedAt: ep, existingKeys: new Set() });
    const plan = planActions({
        mode: "alert",
        now: NOW,
        evaluation: ev,
        senders: [],
        gate: null,
        autoPauseLeft: 5,
        authDomainsLeft: 10,
        episodes: { partitions: new Map([[1, ep]]), senders: new Map() },
        existingDangerKeys: new Set([first]),
    });
    const e = plan.events.find((x) => x.entityType === "partition")!;
    assert.equal(e.worsenedFromBucket, 6);
    assert.notEqual(e.dedupeKey, first);

    const burst = evaluate({
        buckets: [bucket(3, 10, { success: 50 })],
        partitions: [pinfo(3, { workspaceId: 9 })],
        senders: [sinfo(10, { email: "a@x-mail.test" })],
        burst: [{ senderDomain: "x-mail.test", senderProfileId: 10, success: 20, failed: 0, dsnOnly: 0, senderSide: 12, nhnUnsub: 0, unknown: 0 }],
    });
    const bp = planActions({ mode: "alert", now: NOW, evaluation: burst, senders: [sinfo(10, { email: "a@x-mail.test" })], gate: null, autoPauseLeft: 5, authDomainsLeft: 10 });
    const b = bp.events.find((x) => x.kind === "auth_burst");
    assert.ok(b, "폭주 사건이 없다");
    assert.deepEqual(b!.workspaceIds, burst.senders.find((s) => s.profileId === 10)?.workspaceIds ?? []);
});

test("senderDangerText: 사업 스페이스 글에는 그 사업 규칙 이름만 (HB-5)", () => {
    const buckets = [1, 2].flatMap((pid) => [bucket(pid, 10, { success: 92, failed: 8 })]);
    const ev = evaluate({ buckets, partitions: [pinfo(1, { workspaceId: 1 }), pinfo(2, { workspaceId: 2 })] });
    const s = sState(ev, 10)!;
    const input = {
        s,
        mode: "enforce" as const,
        action: "pause" as const,
        actionNote: null,
        partitionNames: new Map([[1, "A 명단"], [2, "B 명단"]]),
        rulePools: [
            { name: "사업A AI 첫 메일", size: 3, workspaceId: 1 },
            { name: "사업B AI 첫 메일", size: 3, workspaceId: 2 },
        ],
        warmup: false,
        baseUrl: "https://sendb.kr",
    };
    const w2 = senderDangerText({ ...input, scope: { workspaceId: 2, partitionWorkspace: new Map([[1, 1], [2, 2]]) } });
    assert.ok(w2.includes("사업B AI 첫 메일"));
    assert.ok(!w2.includes("사업A AI 첫 메일"), w2);
    assert.ok(w2.includes("다른 사업 규칙 1개도"));
    assert.ok(senderDangerText(input).includes("사업A AI 첫 메일"));
});

test("senderWithPartitionsText: 실제 비율을 쓰고 '사실상 하나'·'두 명단'을 쓰지 않는다 (HB-10)", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 92, failed: 8 })] });
    const s = sState(ev, 10)!;
    const t = senderWithPartitionsText({
        s,
        partitions: [
            { partitionId: 1, name: "P1", rateBp: 700, shareBp: 6000 },
            { partitionId: 2, name: "P2", rateBp: 650, shareBp: 8000 },
            { partitionId: 3, name: "P3", rateBp: 600, shareBp: 7000 },
        ],
        held: true,
    });
    assert.ok(t.includes("위험 명단 발송의 60~80%를 이 주소가 보냈습니다"), t);
    assert.ok(t.includes("위험 명단 3개는 보류되어"));
    assert.ok(!t.includes("사실상 하나") && !t.includes("두 명단"));
});

test("syncAlertText: 쉬운 말·할 일·화면 링크, 괄호가 겹치지 않는다 (HS-7)", () => {
    const stale = syncAlertText({ cause: "stale", orgName: "조직", lastOkAt: NOW, lastError: "NHN 조회 일시 오류 (HTTP 500)", baseUrl: "https://sendb.kr", staleMinutes: 40 });
    assert.ok(stale.includes("40분째 멈춰 있습니다"));
    assert.ok(stale.includes("· 이유: NHN 조회 일시 오류 (HTTP 500))"));
    assert.ok(stale.includes("2시간 넘게 이어지면 개발 담당에게"));
    assert.ok(stale.endsWith("자세히: https://sendb.kr/email#send-health"));
    const auth = syncAlertText({ cause: "auth", orgName: "조직", lastOkAt: null, lastError: null });
    assert.ok(auth.includes("발송도 실패하고 있을 수 있습니다"));
    const never = syncAlertText({ cause: "never", orgName: "조직", lastOkAt: null, lastError: null });
    assert.ok(never.includes("개발 담당에게 결과 확인 정기 작업(status-sync) 등록을 부탁해 주세요"));
    assert.ok(syncAlertText({ cause: "never_recovered", orgName: "조직", lastOkAt: null, lastError: null }).includes("돌기 시작했습니다"));
});

test("mergeSyncAlertTexts: 여러 조직의 같은 결과 확인 알림을 한 통으로 (HS-11)", () => {
    const one = (org: string) => syncAlertText({ cause: "auth", orgName: org, lastOkAt: null, lastError: null, baseUrl: "https://sendb.kr" });
    const merged = mergeSyncAlertTexts([one("가"), one("나"), one("다")]);
    const lines = merged.split("\n");
    assert.equal(lines[0], "[발송 건강 · NHN 결과 확인] 조직 3곳에 같은 문제가 있습니다");
    // 같은 설명·할 일 문장은 한 번만, 조직마다 다른 것(마지막 성공)만 목록에 (구글 챗 QA N3)
    assert.deepEqual(lines, [
        "[발송 건강 · NHN 결과 확인] 조직 3곳에 같은 문제가 있습니다",
        "샌드비 이메일 설정의 NHN 키(App Key·Secret Key)가 맞지 않습니다 (NHN 응답 401·403). 같은 키로 메일을 보내므로 발송도 실패하고 있을 수 있습니다.",
        "• 가 — 마지막 성공 없음",
        "• 나 — 마지막 성공 없음",
        "• 다 — 마지막 성공 없음",
        "할 일: 이메일 설정에서 NHN 키를 확인해 주세요. 그동안 자동 조치(보류·멈춤)를 하지 않습니다.",
        "자세히: https://sendb.kr/email#send-health",
    ]);
    assert.equal(merged.split("샌드비 이메일 설정의 NHN 키").length - 1, 1);
    assert.equal(mergeSyncAlertTexts([one("가")]), one("가"));
    // 조직 이름에 " — "·꾸밈·멘션이 있어도 이름과 내용이 갈린다
    const odd = syncAlertText({ cause: "auth", orgName: "A — B <users/all>", lastOkAt: NOW, lastError: null, baseUrl: "https://sendb.kr" });
    assert.equal(mergeSyncAlertTexts([odd, one("나")]).split("\n")[2], "• A — B ‹users/all› — 마지막 성공 10/12 12:00");
    // 정체: 멈춘 시간·이유는 조직마다, 설명은 한 번
    const stale = (org: string, mins: number) =>
        syncAlertText({ cause: "stale", orgName: org, lastOkAt: NOW, lastError: "NHN 조회 일시 오류 (HTTP 500)", baseUrl: "https://sendb.kr", staleMinutes: mins });
    const ms = mergeSyncAlertTexts([stale("가", 40), stale("나", 35)]).split("\n");
    assert.equal(ms[1], "NHN 결과 확인이 30분 넘게 멈춰 있습니다.");
    assert.equal(ms[2], "• 가 — 40분째 멈춤 · 마지막 성공 10/12 12:00 · 이유: NHN 조회 일시 오류 (HTTP 500)");
    assert.equal(ms[3], "• 나 — 35분째 멈춤 · 마지막 성공 10/12 12:00 · 이유: NHN 조회 일시 오류 (HTTP 500)");
    assert.ok(ms[4].startsWith("보통 NHN 쪽 일시 오류라"));
    // 한 번도 안 돎: 조직 이름만
    const never = (org: string) => syncAlertText({ cause: "never", orgName: org, lastOkAt: null, lastError: null, baseUrl: "https://sendb.kr" });
    assert.deepEqual(mergeSyncAlertTexts([never("가"), never("나")]).split("\n").slice(2, 4), ["• 가", "• 나"]);
    // 원인이 섞이면(있으면 안 되지만) 예전처럼 조직마다 첫 줄
    assert.ok(mergeSyncAlertTexts([one("가"), stale("나", 40)]).split("\n")[1].startsWith("• 가 — 샌드비 이메일 설정의 NHN 키"));
    // 11곳 이상은 10곳까지 + 외 N곳
    const many = mergeSyncAlertTexts(Array.from({ length: 12 }, (_, i) => one(`조직${i + 1}`))).split("\n");
    assert.ok(many.includes("• 외 2곳"));
    assert.equal(many.filter((l) => l.startsWith("• 조직")).length, 10);
});

test("사건 키: 결과 확인 알림은 갈래·보낸 때로, 매일 보고는 시험 모드가 따로 (HS-1·HS-4·HD-11)", () => {
    assert.equal(dedupeKey.syncAlert("auth", "alert", NOW), `sync:auth:live:${NOW.getTime()}`);
    assert.equal(dedupeKey.syncAlert("auth", "dry_run", NOW), `sync:auth:dry:${NOW.getTime()}`);
    assert.equal(dedupeKey.report(NOW, "dry_run"), "report:2026-10-12:dry");
    assert.equal(dedupeKey.report(NOW, "alert"), "report:2026-10-12");
});

test("healthWebhookInfo: 형식이 틀린 값은 다음 값으로 넘어가지 않고 형식 오류로, 고칠 변수 이름을 준다 (HR-13·CT-6)", () => {
    const env = {
        SEND_HEALTH_WEBHOOK_URL_1: "http://chat.googleapis.com/v1/spaces/W1/messages",
        DEEP_ALERT_WEBHOOK_URL_1: "https://chat.googleapis.com/v1/spaces/D1/messages?key=k",
        DEEP_ALERT_WEBHOOK_URL_2: "https://example.com/hook",
    };
    const one = healthWebhookInfo(env, 1);
    assert.equal(one.url, null);
    assert.equal(one.source, "SEND_HEALTH_WEBHOOK_URL_1");
    assert.match(one.problem ?? "", /https 주소가 아님/);
    const two = healthWebhookInfo(env, 2);
    assert.equal(two.url, null);
    assert.match(two.problem ?? "", /구글 챗 수신 웹훅 주소가 아님/);
    assert.deepEqual(healthWebhookInfo({}, "ops"), { url: null, source: "SEND_HEALTH_WEBHOOK_URL", problem: "웹훅 주소 없음" });
});

test("dailyReportText: 사업 보고에는 조직 전체 반송·수신거부 숫자·모드를 싣지 않고, 할 일·전달 문제·어제 못 보낸 보고·링크를 싣는다 (HD-02·HD-07·HD-10·HD-14·HD-15·WPN-4)", () => {
    const ev = evaluate({ buckets: [bucket(1, 10, { success: 206, failed: 9 })] });
    const base = {
        orgName: "매치스플랜",
        now: new Date("2026-10-12T00:05:00Z"),
        mode: "alert" as const,
        dsnInRate: false,
        evaluation: ev,
        partitionNames: new Map([[1, "P1"]]),
        senderEmails: new Map<number, string>(),
        continuing: [],
        holds: [],
        autoPaused: [],
        sync: null,
        reply: null,
        nhnUnsub: 1,
        baseUrl: "https://sendb.kr",
    };
    const biz = dailyReportText({ ...base, scopeLabel: "디하", dsn: null, linkUnsub: 2 });
    assert.ok(!biz.includes("어느 메일의 반송인지"), biz);
    assert.ok(!biz.includes("발송 건강 설정:"), biz);
    assert.ok(biz.includes("수신거부: NHN 1통 · 링크 2통"));
    assert.ok(biz.includes("(결과 215통 중 실패 9통)"), biz);
    assert.ok(biz.includes("할 일: "));
    assert.ok(biz.endsWith("자세히: https://sendb.kr/email#send-health"));
    const ops = dailyReportText({
        ...base,
        scopeLabel: null,
        dsn: { unpaired: 3, different: 1, complaints: 1 },
        linkUnsub: 3,
        sync: { lastOkAt: NOW, cursor: NOW, unconfirmedOld: 0, unpaired: 0, lastErrorCode: "transient", lastError: "NHN 조회 일시 오류 (HTTP 503)" },
        deliveryLine: "알림 전달: 어제 못 보낸 알림 2건 (깊이 2)",
        missedReport: "구글 챗 쪽 일시 장애 (구글 챗 500)",
    });
    assert.ok(ops.includes("마지막 오류: NHN 조회 일시 오류 (HTTP 503)"), ops);
    assert.ok(ops.includes("알림 전달: 어제 못 보낸 알림 2건"));
    assert.equal(ops.split("\n")[1], "⚠️ 어제 보고를 보내지 못했습니다 — 구글 챗 쪽 일시 장애 (구글 챗 500)");
    assert.ok(ops.includes("어느 메일의 반송인지 못 찾음 3 · 보낸 주소와 다른 주소에서 돌아온 반송 1"), ops);
    assert.ok(ops.endsWith("발송 건강 설정: 알림만 — 위험해도 자동으로 멈추지 않음\n자세히: https://sendb.kr/email#send-health"), ops);
});

test("dailyReportText: 3,800자를 넘으면 머리·수·할 일·설정·링크는 남기고 목록 줄을 줄여 '외 N건 — 화면에서 보기' (구글 챗 QA N4)", () => {
    const names = Array.from({ length: 5 }, (_, i) => `P${i + 1} ${"아주 긴 명단 이름 🚀".repeat(30)}`);
    const ev = evaluate({ buckets: names.map((_, i) => bucket(i + 1, 10 + i, { success: 206, failed: 9 })), partitions: names.map((n, i) => pinfo(i + 1, { name: n })) });
    const long = (s: string) => `${s} ${"가나다라마바사🏢".repeat(40)}`;
    const text = dailyReportText({
        orgName: long("조직"),
        scopeLabel: null,
        now: new Date("2026-10-12T00:05:00Z"),
        mode: "alert",
        dsnInRate: false,
        evaluation: ev,
        partitionNames: new Map(names.map((n, i) => [i + 1, n])),
        senderEmails: new Map(names.map((_, i) => [10 + i, `${"y".repeat(120)}${i}@a.test`])),
        continuing: names.map((n) => ({ label: `명단 ${n}`, rate: "6.0%" })),
        holds: names.map((n) => ({ name: n, heldAt: NOW, queued: 10 })),
        autoPaused: names.map((n, i) => ({ email: `${"x".repeat(150)}${i}@a.test`, pausedAt: NOW })),
        dsn: { unpaired: 1, different: 1, complaints: 1 },
        sync: { lastOkAt: NOW, cursor: NOW, unconfirmedOld: 0, unpaired: 0, lastErrorCode: "transient", lastError: long("오류") },
        reply: { lastSuccessAt: NOW, mode: "on", replies: 1, bounces: 1 },
        nhnUnsub: 1,
        linkUnsub: 1,
        baseUrl: "https://sendb.kr",
        deliveryLine: `알림 전달: ${"가나다라마바사🏢".repeat(100)}`,
        missedReport: long("까닭"),
    });
    assert.ok(text.length <= ALERT_TEXT_MAX, `길이 ${text.length}`);
    const lines = text.split("\n");
    assert.ok(lines[0].startsWith("[발송 건강 · 10/12(월) 09:05] 조직"));
    assert.ok(lines[1].startsWith("⚠️ 어제 보고를 보내지 못했습니다"));
    assert.ok(lines.some((l) => l.startsWith("위험: ")));
    assert.ok(lines.some((l) => l.startsWith("주의: 명단 5")));
    assert.ok(lines.some((l) => l.startsWith("할 일: ")));
    assert.ok(lines.some((l) => l.startsWith("발송 건강 설정: ")));
    assert.equal(lines.at(-1), "자세히: https://sendb.kr/email#send-health");
    assert.match(text, /\n외 \d+건 — 화면에서 보기\n자세히: /, `길이 ${text.length}`);
    // 늘 담는 줄(알림 전달)도 600자에서 자른다
    assert.ok(lines.find((l) => l.startsWith("알림 전달: "))!.length <= 600);
    // 이름이 아주 길어도 목록 줄 이름은 60자에서 자른다
    assert.ok(lines.filter((l) => l.startsWith("• P")).every((l) => Array.from(l).length < 120), text);
    // 짧은 보고는 그대로 (자르지 않음)
    assert.ok(!dailyReportText({ ...{ orgName: "o", scopeLabel: null, now: NOW, mode: "alert" as const, dsnInRate: false, evaluation: ev, partitionNames: new Map(), senderEmails: new Map(), continuing: [], holds: [], autoPaused: [], dsn: null, sync: null, reply: null, nhnUnsub: 0, linkUnsub: null } }).includes("외 "));
});

test("기본 문턱 값 (5-3)", () => {
    assert.equal(DEFAULT_THRESHOLDS.partitionMinFinal, 200);
    assert.equal(DEFAULT_THRESHOLDS.dangerRateBp, 500);
    assert.equal(DEFAULT_THRESHOLDS.cautionRateBp, 300);
    assert.equal(DEFAULT_THRESHOLDS.pairMaxPValue, 0.01);
    assert.equal(DEFAULT_THRESHOLDS.syncStaleMs, 30 * 60 * 1000);
});

test("스레드 키: 매일 보고는 조직·받는 곳마다, 결과 확인 알림은 조직마다, 묶음·풀림은 없음 (HD-14·HB-8)", () => {
    const org = "1ba7c0de-0000-4000-8000-000000000001";
    assert.equal(healthThreadKey("report:2026-10-12", org, "ops"), "health-report-1ba7c0de-ops");
    assert.equal(healthThreadKey("report:2026-10-13:dry", org, "ws:14"), "health-report-1ba7c0de-ws14");
    assert.equal(healthThreadKey("sync:auth:live:1760000000000", org, "ops"), "health-sync-1ba7c0de");
    assert.equal(healthThreadKey("sync:recovered:1760000000000", org, "ops"), "health-sync-1ba7c0de");
    assert.equal(healthThreadKey("run:1760000000000", org, "ops"), undefined);
    assert.equal(healthThreadKey("release:hold:3", org, "ws:14"), undefined);
});

test("회복 글 열쇠는 알린 원인을 넣어 같은 때 알린 다른 원인 구간과 겹치지 않는다 (HS-1)", () => {
    const at = new Date("2026-10-12T01:00:00Z");
    assert.equal(dedupeKey.syncRecovered(at, "auth"), `sync:recovered:auth:${at.getTime()}`);
    assert.notEqual(dedupeKey.syncRecovered(at, "auth"), dedupeKey.syncRecovered(at, "stale"));
    assert.equal(dedupeKey.syncRecovered(at), `sync:recovered:${at.getTime()}`);
});
