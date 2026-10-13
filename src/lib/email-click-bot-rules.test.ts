import test from "node:test";
import assert from "node:assert/strict";
import { isBotUserAgent, isEarlyClick, instantBotReason, newBurstClickIds, type BurstClick } from "./email-click-bot-rules";

const SENT = new Date("2026-10-13T00:00:00.000Z");
const at = (ms: number) => new Date(SENT.getTime() + ms);
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const bc = (id: number, ms: number, { sendLogId = 1, isBot = false } = {}): BurstClick => ({ id, sendLogId, clickedAt: at(ms), isBot });
const reason = (userAgent: string | null | undefined, ms = 60_000) => instantBotReason({ userAgent, sentAt: SENT, clickedAt: at(ms) });

test("B1: null·undefined·빈 문자열·공백 UA는 ua", () => {
    for (const ua of [null, undefined, "", "   ", "\t"]) {
        assert.equal(isBotUserAgent(ua), true);
        assert.equal(reason(ua), "ua");
    }
});

test("B2: 모든 R6 토큰은 대소문자에 관계없이 ua", () => {
    const agents = [
        "curl/8.4.0", "python-requests/2.31.0", "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
        "Ruby", "Go-http-client/1.1", "Java/17.0.2", "Mozilla/5.0 (compatible; LinkGuard/2.0)",
        "AntiSpam-Engine/3.1", "Linker/1.0", "Mozilla/5.0 (compatible; URLScan/4.0)",
        "Mozilla/5.0 (compatible; Googlebot/2.1)", "Baiduspider/2.0", "Mozilla/5.0 (Windows NT 10.0) LinkPreview/1.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
        "Wget/1.21.4", "okhttp/4.12.0", "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 6.1)",
    ];
    for (const ua of agents.flatMap((value) => [value, value.toUpperCase(), value.toLowerCase()])) {
        assert.equal(isBotUserAgent(ua), true, ua);
        assert.equal(reason(ua), "ua", ua);
    }
});

test("B3: 단순 Chrome 접두·알려진 CUBOT 오탐과 정상 브라우저를 구분", () => {
    const bots = ["Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36", "mozilla/5.0 chrome/99", "MOZILLA/5.0 CHROME/1",
        "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"];
    const humans = ["X Mozilla/5.0 Chrome/120", "Mozilla/5x0 Chrome/1", CHROME, `${CHROME} Edg/129.0.0.0`,
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
        "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36;KAKAOTALK 2410710"];
    for (const ua of bots) {
        assert.equal(isBotUserAgent(ua), true, ua);
        assert.equal(reason(ua), "ua", ua);
    }
    for (const ua of humans) {
        assert.equal(isBotUserAgent(ua), false, ua);
        assert.equal(reason(ua), null, ua);
    }
});

test("B4: early는 음수를 포함한 15초 미만이고 정각은 제외", () => {
    for (const ms of [14_999, 0, -1_000, 15_000, 15_001]) {
        assert.equal(isEarlyClick(SENT, at(ms)), ms < 15_000);
        assert.equal(reason(CHROME, ms), ms < 15_000 ? "early" : null);
    }
});

test("B5: ua → early → burst 우선순위와 기존 봇 사유 보존", () => {
    assert.equal(reason("curl/8.4.0", 1_000), "ua");
    assert.equal(reason(null, 0), "ua");
    assert.equal(reason(CHROME, 1_000), "early");
    assert.deepEqual(newBurstClickIds([bc(1, 0, { isBot: true }), bc(2, 2_000, { isBot: true }), bc(3, 4_000)]), [3]);
    assert.deepEqual(newBurstClickIds([bc(1, 0, { isBot: true }), bc(2, 1_000, { isBot: true }), bc(3, 2_000, { isBot: true })]), []);
});

test("B6: burst 정각·초과·사슬·같은 시각·입력 순서·빈 입력", () => {
    const cases: [number[], number[]][] = [
        [[0, 5_000, 10_000], [1, 2, 3]], [[0, 5_000, 10_001], [2]],
        [[0, 9_000, 18_000], [2]], [[0, 3_000], []], [[0, 0, 0], [1, 2, 3]], [[], []],
    ];
    for (const [times, expected] of cases) {
        assert.deepEqual(newBurstClickIds(times.map((ms, index) => bc(index + 1, ms))), expected);
    }
    const clicks = [bc(3, 10_000), bc(1, 0), bc(2, 5_000)];
    const before = structuredClone(clicks);
    assert.deepEqual(newBurstClickIds(clicks), [1, 2, 3]);
    assert.deepEqual(clicks, before);
});

test("B7: 봇도 이웃으로 세고 다른 발송은 격리", () => {
    assert.deepEqual(newBurstClickIds([bc(1, 0, { isBot: true }), bc(2, 1_000, { isBot: true }), bc(3, 2_000)]), [3]);
    assert.deepEqual(newBurstClickIds([bc(1, 0), bc(2, 1_000, { sendLogId: 2 }), bc(3, 2_000)]), []);
    assert.deepEqual(newBurstClickIds([bc(1, 0), bc(2, 500, { sendLogId: 2 }), bc(3, 1_000, { sendLogId: 2 }), bc(4, 1_500, { sendLogId: 2 }), bc(5, 2_000)]), [2, 3, 4]);
});
