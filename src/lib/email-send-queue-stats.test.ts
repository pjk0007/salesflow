import { test } from "node:test";
import assert from "node:assert";
import {
    BACKLOG_WARNING_DAYS,
    QUEUE_STATS_DAYS,
    backlogLoad,
    buildSendQueueStats,
    bulkShareOf,
    estimateDrainDate,
    poolCapacitySchedule,
    poolDayCapacity,
    poolRemainingToday,
    poolTodayBulkCap,
    type DayCapacity,
    type QueueStatsGroup,
    type QueueStatsRule,
    type QueueStatsSender,
} from "./email-send-queue-stats";
import { DEFAULT_LIMIT_SETTINGS, type SenderLimitSettings } from "./email-sender-limit-rules";

// 2026-10-03 토요일, 10-04 일요일, 10-05 월요일

const at = (kst: string): Date => new Date(`${kst}:00+09:00`);
const limits = (over: Partial<SenderLimitSettings> = {}): SenderLimitSettings => ({
    ...DEFAULT_LIMIT_SETTINGS,
    ...over,
});
const member = (over: Partial<SenderLimitSettings> = {}, sentToday = 0) => ({ limits: limits(over), sentToday });
const day = (date: string, cap: number | null, total: number | null = cap): DayCapacity => ({ date, cap, total });

// ── 하루 용량 ──

test("bulkShareOf: 한도에서 문의 몫(10% 올림)을 뺀 양", () => {
    assert.equal(bulkShareOf(10), 9);
    assert.equal(bulkShareOf(30), 27);
    assert.equal(bulkShareOf(1), 1);
    assert.equal(bulkShareOf(0), 0);
    assert.equal(bulkShareOf(null), null);
});

test("poolDayCapacity: 주소별 합, 한도 없는 주소가 있으면 제한 없음", () => {
    assert.deepEqual(poolDayCapacity([limits({ dailyLimit: 10 }), limits({ dailyLimit: 4 })], "2026-10-05"), {
        date: "2026-10-05",
        cap: 12,
        total: 14,
    });
    assert.deepEqual(poolDayCapacity([limits({ dailyLimit: 10 }), limits()], "2026-10-05"), {
        date: "2026-10-05",
        cap: null,
        total: null,
    });
    // 주소가 없으면(레거시 설정 발신자) 카운터가 없어 제한 없음
    assert.deepEqual(poolDayCapacity([], "2026-10-05"), { date: "2026-10-05", cap: null, total: null });
    // 정지는 0, 평일만인데 주말이면 0 — 한도 없는 주소라도
    assert.deepEqual(poolDayCapacity([limits({ isPaused: true }), limits({ dailyLimit: 10 })], "2026-10-05"), {
        date: "2026-10-05",
        cap: 9,
        total: 10,
    });
    assert.deepEqual(poolDayCapacity([limits({ weekdaysOnly: true })], "2026-10-03"), {
        date: "2026-10-03",
        cap: 0,
        total: 0,
    });
});

test("poolCapacitySchedule: 14일, 웜업은 날마다 오른다", () => {
    const warm = limits({ warmupEnabled: true, warmupStartCount: 10, warmupStep: 10, dailyLimit: 30, warmupStartedOn: "2026-10-05" });
    const s = poolCapacitySchedule([warm], "2026-10-05");
    assert.equal(s.length, QUEUE_STATS_DAYS);
    assert.deepEqual(s.slice(0, 4), [
        day("2026-10-05", 9, 10),
        day("2026-10-06", 18, 20),
        day("2026-10-07", 27, 30),
        day("2026-10-08", 27, 30),
    ]);
    assert.deepEqual(poolCapacitySchedule([warm], "2026-10-05", 0), []);
});

test("poolRemainingToday: 지금부터 더 보낼 수 있는 양, 오늘 다시 안 열리는 주소는 0", () => {
    const morning = at("2026-10-05T10:00");
    // 한도 10에 3통 썼다 — 대량은 몫 1을 남겨 6, 문의 포함 7
    assert.deepEqual(poolRemainingToday([member({ dailyLimit: 10 }, 3)], morning), { cap: 6, total: 7 });
    // 15:00부터는 몫이 풀린다
    assert.deepEqual(poolRemainingToday([member({ dailyLimit: 10 }, 3)], at("2026-10-05T15:00")), { cap: 7, total: 7 });
    // 시간대(9~12시)가 지났으면 0
    assert.deepEqual(
        poolRemainingToday([member({ dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 12 }, 3)], at("2026-10-05T13:00")),
        { cap: 0, total: 0 },
    );
    // 시간대 전이면 오늘 열린다
    assert.deepEqual(
        poolRemainingToday([member({ dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 12 })], at("2026-10-05T07:00")),
        { cap: 9, total: 10 },
    );
    // 정지 0, 오늘 열리는 한도 없는 주소가 있으면 제한 없음
    assert.deepEqual(poolRemainingToday([member({ isPaused: true })], morning), { cap: 0, total: 0 });
    assert.deepEqual(poolRemainingToday([member({ dailyLimit: 10 }), member()], morning), { cap: null, total: null });
    // 다 썼으면 음수가 아니라 0
    assert.deepEqual(poolRemainingToday([member({ dailyLimit: 10 }, 12)], morning), { cap: 0, total: 0 });
});

// ── 예상 소진일 ──

test("estimateDrainDate: 오늘 남은 양부터, 새 문의가 없으면 15:00에 풀리는 문의 몫도 대량이 쓴다 (REVIEW-2 정책 F5)", () => {
    const pool = [member({ dailyLimit: 10 })];
    const mon8 = at("2026-10-05T08:00");
    // 오전 9통 + 15:00 뒤 1통 = 하루 10통 (실제 워커와 같다): 오늘 10 → 18 남음, 화 10 → 8, 수에 끝
    assert.equal(estimateDrainDate(pool, { inbound: 0, bulk: 28 }, mon8), "2026-10-07");
    assert.equal(estimateDrainDate(pool, { inbound: 0, bulk: 9 }, mon8), "2026-10-05");
    // 예전에는 앞날을 대량 몫(9)으로만 세어 10통이 화요일로 나왔다 — 실제로는 월요일 15:00에 다 나간다
    assert.equal(estimateDrainDate(pool, { inbound: 0, bulk: 10 }, mon8), "2026-10-05");
    assert.equal(estimateDrainDate(pool, { inbound: 0, bulk: 11 }, mon8), "2026-10-06");
    // 문의는 한도 전체를 쓴다
    assert.equal(estimateDrainDate(pool, { inbound: 10, bulk: 0 }, mon8), "2026-10-05");
    // 문의가 먼저 쓰고 대량은 남은 만큼: 오늘 문의 5 + 대량 5, 내일 대량 10
    assert.equal(estimateDrainDate(pool, { inbound: 5, bulk: 15 }, mon8), "2026-10-06");
    assert.equal(estimateDrainDate(pool, { inbound: 5, bulk: 16 }, mon8), "2026-10-07");
});

test("estimateDrainDate: 시간대가 15시 전에 끝나는 주소도 시간대 안에서 몫이 풀려 하루 한도를 다 쓴다", () => {
    // 9~13시, 한도 10 — 몫은 12:00에 풀린다 (reserveReleaseHour). 예전 워커는 매일 9통에서 멈췄다
    const pool = [member({ dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 13 })];
    assert.equal(estimateDrainDate(pool, { inbound: 0, bulk: 20 }, at("2026-10-05T08:00")), "2026-10-06");
    assert.equal(estimateDrainDate(pool, { inbound: 0, bulk: 21 }, at("2026-10-05T08:00")), "2026-10-07");
});

test("estimateDrainDate: 대기 없음·14일 넘음은 null, 제한 없는 날이면 그날", () => {
    const mon8 = at("2026-10-05T08:00");
    assert.equal(estimateDrainDate([member({ dailyLimit: 10 })], { inbound: 0, bulk: 0 }, mon8), null);
    // 하루 10통으로 14일에 140통 — 141통은 2주 넘게
    assert.equal(estimateDrainDate([member({ dailyLimit: 10 })], { inbound: 0, bulk: 140 }, mon8), "2026-10-18");
    assert.equal(estimateDrainDate([member({ dailyLimit: 10 })], { inbound: 0, bulk: 141 }, mon8), null);
    assert.equal(estimateDrainDate([member()], { inbound: 3, bulk: 5000 }, mon8), "2026-10-05");
    assert.equal(estimateDrainDate([member({ isPaused: true })], { inbound: 0, bulk: 1 }, mon8), null);
});

// ── 밀린 날수·3일치 경고 (Q6) ──

test("Q6: 대기 ÷ 하루 용량이 3을 넘으면 경고", () => {
    const schedule = [day("2026-10-05", 9), day("2026-10-06", 9), day("2026-10-07", 9)];
    assert.deepEqual(backlogLoad(28, schedule), { unlimited: false, dailyCapacity: 9, backlogDays: 3.11, warning: true });
    // 딱 3일치는 경고 아님 (넘음 = 초과)
    assert.deepEqual(backlogLoad(27, schedule), { unlimited: false, dailyCapacity: 9, backlogDays: 3, warning: false });
    assert.deepEqual(backlogLoad(0, schedule), { unlimited: false, dailyCapacity: 9, backlogDays: 0, warning: false });
    assert.equal(BACKLOG_WARNING_DAYS, 3);
});

test("Q6: 오늘~내일 평균 — 웜업으로 내일 용량이 크면 평균으로", () => {
    // (9 + 18) / 2 = 13.5 → 50 / 13.5 = 3.7
    const schedule = [day("2026-10-05", 9), day("2026-10-06", 18)];
    assert.deepEqual(backlogLoad(50, schedule), { unlimited: false, dailyCapacity: 13.5, backlogDays: 3.7, warning: true });
});

test("Q6: 한도 없는 묶음은 제한 없음, 경고 없음", () => {
    const schedule = [day("2026-10-05", null), day("2026-10-06", null)];
    assert.deepEqual(backlogLoad(100000, schedule), { unlimited: true, dailyCapacity: null, backlogDays: null, warning: false });
});

test("Q6: 평일만 보내는 묶음은 주말 0을 빼고 보낼 수 있는 날로 나눈다", () => {
    // 토·일 0, 월·화 9 — 토요일에 대기 20통은 20/9 = 2.22일치 (주말마다 경고하지 않게)
    const schedule = [day("2026-10-03", 0), day("2026-10-04", 0), day("2026-10-05", 9), day("2026-10-06", 9)];
    assert.deepEqual(backlogLoad(20, schedule), { unlimited: false, dailyCapacity: 9, backlogDays: 2.22, warning: false });
});

test("Q6: 보낼 수 있는 날이 없으면(전부 정지) 대기가 있을 때 경고", () => {
    const schedule = [day("2026-10-05", 0), day("2026-10-06", 0)];
    assert.deepEqual(backlogLoad(1, schedule), { unlimited: false, dailyCapacity: 0, backlogDays: null, warning: true });
    assert.deepEqual(backlogLoad(0, schedule), { unlimited: false, dailyCapacity: 0, backlogDays: null, warning: false });
});

// ── 규칙별 통계 ──

const sender = (
    id: number,
    over: Partial<SenderLimitSettings> = {},
    sentToday = 0,
    isDefault = false,
): QueueStatsSender => ({
    id,
    fromEmail: `s${id}@example.test`,
    fromName: `발신 ${id}`,
    isDefault,
    limits: limits(over),
    sentToday,
});
const rule = (id: number, over: Partial<QueueStatsRule> = {}): QueueStatsRule => ({
    id,
    partitionId: 1,
    triggerType: "on_create",
    senderProfileId: null,
    senderProfileIds: null,
    ...over,
});
const group = (over: Partial<QueueStatsGroup>): QueueStatsGroup => ({
    partitionId: 1,
    triggerType: "on_create",
    priority: 0,
    count: 0,
    oldestScheduledAt: null,
    ...over,
});

test("buildSendQueueStats: 규칙 → 파티션·트리거의 대기 줄, 문의/대량 나눠 세기, 가장 이른 시각", () => {
    const now = at("2026-10-05T08:00");
    const stats = buildSendQueueStats({
        rules: [rule(11, { senderProfileIds: [2, 1] }), rule(12, { triggerType: "on_update", senderProfileIds: [1] })],
        groups: [
            group({ priority: 0, count: 40, oldestScheduledAt: at("2026-10-04T09:00") }),
            group({ priority: 1, count: 2, oldestScheduledAt: at("2026-10-05T07:30") }),
            group({ triggerType: "on_update", priority: 1, count: 1, oldestScheduledAt: at("2026-10-05T07:00") }),
            // 규칙 없는 파티션 — 합계에는 센다
            group({ partitionId: 9, count: 5, oldestScheduledAt: at("2026-10-01T09:00") }),
        ],
        senders: [sender(1, { dailyLimit: 10 }), sender(2, { dailyLimit: 10 }), sender(3, {}, 0, true)],
        now,
    });

    assert.equal(stats.today, "2026-10-05");
    assert.equal(stats.rules.length, 2);
    const r11 = stats.rules[0];
    assert.equal(r11.linkId, 11);
    assert.deepEqual(r11.pending, { total: 42, inbound: 2, bulk: 40 });
    assert.equal(r11.oldestScheduledAt, at("2026-10-04T09:00").toISOString());
    // 묶음 순서대로 (규칙에 적힌 순서)
    assert.deepEqual(r11.poolProfileIds, [2, 1]);
    assert.equal(r11.capacity.unlimited, false);
    assert.equal(r11.capacity.today, 18);
    assert.equal(r11.capacity.todayRemaining, 18);
    assert.equal(r11.capacity.schedule.length, QUEUE_STATS_DAYS);
    assert.equal(r11.dailyCapacity, 18);
    // 42 / 18 = 2.33
    assert.equal(r11.backlogDays, 2.33);
    assert.equal(r11.warning, false);
    // 오늘 문의 2 + 대량 18 (한도 20 중 문의가 쓰고 남은 양 — 15:00에 몫이 풀린다) → 22 남음, 화 20 → 2, 수에 끝
    assert.equal(r11.etaDate, "2026-10-07");

    const r12 = stats.rules[1];
    assert.equal(r12.triggerType, "on_update");
    assert.deepEqual(r12.pending, { total: 1, inbound: 1, bulk: 0 });

    // 합계는 줄마다 한 번 (규칙 수와 상관없이), 규칙 없는 파티션 포함
    assert.equal(stats.totals.pending, 48);
    assert.equal(stats.totals.inbound, 3);
    assert.equal(stats.totals.bulk, 45);
    assert.equal(stats.totals.oldestScheduledAt, at("2026-10-01T09:00").toISOString());
    assert.equal(stats.totals.warnings, 0);
});

test("buildSendQueueStats: 3일치를 넘으면 경고 규칙으로 센다 (Q6)", () => {
    const stats = buildSendQueueStats({
        rules: [rule(11, { senderProfileIds: [1] })],
        groups: [group({ count: 28 })],
        senders: [sender(1, { dailyLimit: 10 })],
        now: at("2026-10-05T08:00"),
    });
    assert.equal(stats.rules[0].backlogDays, 3.11);
    assert.equal(stats.rules[0].warning, true);
    assert.deepEqual(stats.totals.warningLinkIds, [11]);
    assert.equal(stats.totals.warnings, 1);
});

test("buildSendQueueStats: 한도 없는 주소가 섞인 묶음·레거시 발신자는 제한 없음, 경고·소진일 없음 (Q6·Q9)", () => {
    const base = {
        groups: [group({ count: 5000 })],
        senders: [sender(1, { dailyLimit: 10 }), sender(2)],
        now: at("2026-10-05T08:00"),
    };
    const mixed = buildSendQueueStats({ ...base, rules: [rule(11, { senderProfileIds: [1, 2] })] }).rules[0];
    assert.equal(mixed.capacity.unlimited, true);
    assert.equal(mixed.capacity.today, null);
    assert.equal(mixed.backlogDays, null);
    assert.equal(mixed.etaDate, null);
    assert.equal(mixed.warning, false);

    // 묶음이 비었고 기본 주소도 없으면 레거시 설정 발신자 → 카운터 없음 → 제한 없음
    const legacy = buildSendQueueStats({ ...base, rules: [rule(12)] }).rules[0];
    assert.deepEqual(legacy.poolProfileIds, []);
    assert.equal(legacy.capacity.unlimited, true);
    assert.equal(legacy.warning, false);
});

test("buildSendQueueStats: 묶음이 비면 claimSender처럼 기본 주소, 다른 조직 id는 빠진다", () => {
    const stats = buildSendQueueStats({
        rules: [rule(11), rule(12, { senderProfileIds: [999, 1] }), rule(13, { senderProfileId: 1, senderProfileIds: "x" })],
        groups: [],
        senders: [sender(1, { dailyLimit: 10 }), sender(2, { dailyLimit: 20 }, 0, true)],
        now: at("2026-10-05T08:00"),
    });
    assert.deepEqual(stats.rules[0].poolProfileIds, [2]);
    assert.deepEqual(stats.rules[1].poolProfileIds, [1]);
    // jsonb에 배열이 아닌 값이 있으면 옛 칸 하나
    assert.deepEqual(stats.rules[2].poolProfileIds, [1]);
    // 대기가 없으면 소진일 없음, 경고 없음
    assert.deepEqual(stats.rules[0].pending, { total: 0, inbound: 0, bulk: 0 });
    assert.equal(stats.rules[0].etaDate, null);
    assert.equal(stats.rules[0].oldestScheduledAt, null);
    assert.equal(stats.rules[0].warning, false);
    assert.equal(stats.totals.pending, 0);
    assert.equal(stats.totals.oldestScheduledAt, null);
});

test("poolTodayBulkCap: 15:00 전에는 대량 몫 합계, 15:00부터는 한도 합계, 제한 없음은 null", () => {
    const two = [limits({ dailyLimit: 10 }), limits({ dailyLimit: 10 })];
    assert.equal(poolTodayBulkCap(two, at("2026-10-05T14:59")), 18);
    assert.equal(poolTodayBulkCap(two, at("2026-10-05T15:00")), 20);
    assert.equal(poolTodayBulkCap([limits({ dailyLimit: 10 }), limits()], at("2026-10-05T08:00")), null);
    assert.equal(poolTodayBulkCap([], at("2026-10-05T08:00")), null);
    // 시간대가 9~13시면 몫이 12:00에 풀린다 (reserveReleaseHour) — 실제 자리 잡기와 같은 기준
    const early = [limits({ dailyLimit: 10, sendWindowStart: 9, sendWindowEnd: 13 }), limits({ dailyLimit: 10 })];
    assert.equal(poolTodayBulkCap(early, at("2026-10-05T11:59")), 18);
    assert.equal(poolTodayBulkCap(early, at("2026-10-05T12:00")), 19);
});

test("buildSendQueueStats: 15:00 뒤 오늘 용량은 문의 몫이 풀린 한도라 오늘 남은 양보다 작지 않다", () => {
    const input = {
        rules: [rule(11, { senderProfileIds: [1] })],
        groups: [group({ count: 3 })],
        senders: [sender(1, { dailyLimit: 5 })],
    };
    // 한도 5, 문의 몫 1 → 15:00 전 대량 4
    const morning = buildSendQueueStats({ ...input, now: at("2026-10-05T08:00") }).rules[0];
    assert.equal(morning.capacity.today, 4);
    assert.equal(morning.capacity.todayRemaining, 4);
    // 15:00부터 몫이 풀려 5 (예전에는 today 4 · todayRemaining 5로 어긋났다)
    const afternoon = buildSendQueueStats({ ...input, now: at("2026-10-05T16:00") }).rules[0];
    assert.equal(afternoon.capacity.today, 5);
    assert.equal(afternoon.capacity.todayRemaining, 5);
    // 하루 일정(schedule)은 그대로 대량 몫 기준이다 — 경고 분모가 시각에 따라 흔들리지 않게
    assert.equal(afternoon.capacity.schedule[0].cap, 4);
    assert.equal(afternoon.capacity.schedule[0].total, 5);
});
