import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOT_UA_PATTERN, EARLY_CLICK_MS, BURST_WINDOW_MS, BURST_MIN_NEIGHBORS } from "./email-click-bot-rules";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const flatSql = () => read("drizzle/0080_email_click_bot.sql").replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

test("B13: SQL UA·early·burst 기준은 TS 상수와 일치", () => {
    const flat = flatSql();
    assert.doesNotMatch(BOT_UA_PATTERN, /['\\]/);
    assert.ok(flat.includes(`"user_agent" ~* '${BOT_UA_PATTERN}'`));
    assert.ok(flat.includes('"user_agent" IS NULL'));
    assert.ok(flat.includes(`"user_agent" ~ '^[[:space:]]*$'`));
    assert.equal(EARLY_CLICK_MS % 1000, 0);
    assert.ok(flat.includes(`< s."sent_at" + interval '${EARLY_CLICK_MS / 1000} seconds'`));
    assert.equal(BURST_WINDOW_MS % 1000, 0);
    const window = BURST_WINDOW_MS / 1000;
    assert.ok(flat.includes(`RANGE BETWEEN interval '${window} seconds' PRECEDING AND interval '${window} seconds' FOLLOWING`));
    assert.ok(flat.includes(`n."neighbors" >= ${BURST_MIN_NEIGHBORS}`));
});

test("B5·B11: 백필은 ua → early → burst 순서이며 기존 사유를 보존", () => {
    const flat = flatSql();
    const positions = ["ua", "early", "burst"].map((reason) => flat.indexOf(`"bot_reason" = '${reason}'`));
    assert.ok(positions[0] >= 0 && positions[0] < positions[1] && positions[1] < positions[2]);
    assert.equal(flat.match(/"is_bot" = false/g)?.length, 3);
});

test("B13: 봇 판정은 트래커 데이터를 참조하지 않고 규칙은 import 없음", () => {
    assert.doesNotMatch(flatSql(), /tracker_/);
    assert.doesNotMatch(read("src/lib/email-click-bot-rules.ts"), /^\s*import\s/m);
    assert.doesNotMatch(read("src/lib/email-click-tracking.ts"), /tracker(Sessions|Events|Sites)|tracker_/);
});

test("B14: lock_timeout 5s와 journal idx 80 등록", () => {
    assert.ok(flatSql().trimStart().startsWith("SET LOCAL lock_timeout = '5s';"));
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string; when: number }[] };
    const entries = journal.entries.filter((entry) => entry.idx === 80);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tag, "0080_email_click_bot");
    assert.equal(entries[0].when, 1774300000000);
    assert.ok(entries[0].when > journal.entries.find((entry) => entry.idx === 79)!.when);
});
