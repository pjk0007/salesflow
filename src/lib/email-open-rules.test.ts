import test from "node:test";
import assert from "node:assert/strict";
import { isEarlyOpen, isMachineOpenUserAgent, machineOpenReason, shouldStoreOpen, shouldLogDroppedOpens } from "./email-open-rules";

const SENT = new Date("2026-10-21T00:00:00Z");
const at = (ms: number) => new Date(SENT.getTime() + ms);
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const reason = (userAgent: string | null | undefined, ms = 120_000) =>
    machineOpenReason({ userAgent, sentAt: SENT, openedAt: at(ms) });

test("B11: 60초 미만과 음수만 early", () => {
    for (const ms of [59_999, 0, -1_000, 60_000, 60_001]) {
        assert.equal(isEarlyOpen(SENT, at(ms)), ms < 60_000);
        assert.equal(reason(CHROME, ms), ms < 60_000 ? "early" : null);
    }
});
test("B12: 비어 있는 UA는 기계", () => {
    for (const ua of [null, undefined, "", "   ", "\t"]) {
        assert.equal(isMachineOpenUserAgent(ua), true);
        assert.equal(reason(ua), "ua");
    }
});
test("B13: 22종 기계 UA와 CUBOT은 대소문자 무관 ua", () => {
    const agents = [
    "curl/8.4.0",
    "python-requests/2.31.0",
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
    "axios/1.7.2",
    "Ruby",
    "Go-http-client/1.1",
    "Java/17.0.2",
    "okhttp/4.12.0",
    "Apache-HttpClient/4.5.14",
    "libwww-perl/6.72",
    "Wget/1.21.4",
    "Mozilla/5.0 (compatible; LinkGuard/2.0)",
    "AntiSpam-Engine/3.1",
    "Linker/1.0",
    "Mozilla/5.0 (compatible; URLScan/4.0)",
    "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "Baiduspider/2.0",
    "Mozilla/5.0 (compatible; ExampleCrawler/1.0)",
    "Mozilla/5.0 (Windows NT 10.0) LinkPreview/1.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 (KHTML, like Gecko) PhantomJS/2.1.1 Safari/538.1",
    "Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
];
    assert.equal(agents.length, 23);
    for (const ua of agents.flatMap(value => [value, value.toUpperCase(), value.toLowerCase()])) {
        assert.equal(isMachineOpenUserAgent(ua), true, ua);
        assert.equal(reason(ua), "ua", ua);
    }
});
test("B14: 프록시·Outlook·Apple·브라우저는 시간 규칙만 적용", () => {
    const agents = [CHROME, `${CHROME} Edg/129.0.0.0`, ...[
    "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)",
    "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html",
    "Mozilla/4.0 (compatible; MSIE 7.0; Windows NT 10.0; WOW64; Trident/7.0; .NET4.0C; .NET4.0E; Microsoft Outlook 16.0.17928; ms-office; MSOffice 16)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    "Mozilla/5.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    "Mozilla/5.0 (via ggpht.com GoogleImageProxy) scan",
    "Mozilla/5x0 Chrome/1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36;KAKAOTALK 2410710"
]];
    for (const ua of agents) {
        assert.equal(isMachineOpenUserAgent(ua), false, ua);
        assert.equal(reason(ua), null, ua);
        assert.equal(reason(ua, 1_000), "early", ua);
    }
});
test("B15: ua가 early보다 우선", () => {
    assert.equal(reason("curl/8.4.0", 1_000), "ua");
    assert.equal(reason(null, 0), "ua");
    assert.equal(reason("GoogleImageProxy", 1_000), "early");
});
test("B10: 추적 대상만 사람·기계별 독립 상한 적용", () => {
    const cases: [boolean, boolean, number, number, boolean][] = [
        [true, false, 0, 0, true], [true, false, 19, 10, true],
        [true, false, 20, 0, false], [true, true, 0, 9, true],
        [true, true, 50, 10, false], [false, false, 0, 0, false], [false, true, 0, 0, false],
    ];
    for (const [openTracked, isMachine, storedHuman, storedMachine, expected] of cases) {
        assert.equal(shouldStoreOpen({ openTracked, isMachine, storedHuman, storedMachine }), expected);
    }
});

test("동시 상한 경고는 누계가 있고 마지막 로그부터 60초 이상일 때만 남긴다", () => {
    for (const elapsed of [-1, 0, 59_999, 60_000, 60_001]) {
        assert.equal(shouldLogDroppedOpens(3, 100_000, 100_000 + elapsed), elapsed >= 60_000);
    }
    assert.equal(shouldLogDroppedOpens(0, 100_000, 160_000), false);
});
test("동시 상한 경고 후 누계를 비우고 시각을 갱신하면 다음 60초 동안 억제한다", () => {
    assert.equal(shouldLogDroppedOpens(15, 100_000, 160_000), true);
    assert.equal(shouldLogDroppedOpens(0, 160_000, 160_000), false);
    assert.equal(shouldLogDroppedOpens(1, 160_000, 160_001), false);
    assert.equal(shouldLogDroppedOpens(50, 160_000, 219_999), false);
    assert.equal(shouldLogDroppedOpens(51, 160_000, 220_000), true);
});
