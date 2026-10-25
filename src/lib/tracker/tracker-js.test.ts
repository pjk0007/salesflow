import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/**
 * public/tracker.js는 고객 사이트에 그대로 실리는 IIFE라 import할 수 없다.
 * 실제 파일에서 함수 본문을 잘라 vm에서 실행한다 (문구 검색이 아니라 동작 확인).
 */
const SOURCE = readFileSync(join(process.cwd(), "public", "tracker.js"), "utf8");

function extractFunction(name: string): string {
    const start = SOURCE.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} 함수를 찾지 못했습니다`);
    let depth = 0;
    for (let i = SOURCE.indexOf("{", start); i < SOURCE.length; i++) {
        if (SOURCE[i] === "{") depth++;
        else if (SOURCE[i] === "}" && --depth === 0) return SOURCE.slice(start, i + 1);
    }
    throw new Error(`${name} 함수 끝을 찾지 못했습니다`);
}

type Device = { type: string; browser: string; os: string };

function detect(userAgent: string, maxTouchPoints = 0): Device {
    const ctx = vm.createContext({ navigator: { userAgent, maxTouchPoints } });
    return vm.runInContext(`${extractFunction("detectDevice")}; detectDevice();`, ctx) as Device;
}

const UA = {
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ipadOld: "Mozilla/5.0 (iPad; CPU OS 12_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
    androidPhone: "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
    androidTablet: "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
};

test("UX-218 detectDevice: 데스크톱 OS는 그대로", () => {
    assert.deepStrictEqual(
        [detect(UA.windows), detect(UA.mac), detect(UA.linux)].map((d) => [d.os, d.type]),
        [["Windows", "desktop"], ["macOS", "desktop"], ["Linux", "desktop"]],
    );
});

test("UX-218 detectDevice: iPhone·iPad는 iOS, Android는 Android (Mac·Linux로 세지 않는다)", () => {
    assert.deepStrictEqual([detect(UA.iphone).os, detect(UA.iphone).type], ["iOS", "mobile"]);
    assert.deepStrictEqual([detect(UA.ipadOld).os, detect(UA.ipadOld).type], ["iOS", "tablet"]);
    assert.deepStrictEqual([detect(UA.androidPhone).os, detect(UA.androidPhone).type], ["Android", "mobile"]);
    assert.deepStrictEqual([detect(UA.androidTablet).os, detect(UA.androidTablet).type], ["Android", "tablet"]);
});

test("UX-218 detectDevice: 데스크톱 UA를 보내는 iPadOS(터치 여러 지점)는 iOS 태블릿, 터치 없는 Mac은 macOS", () => {
    assert.deepStrictEqual([detect(UA.mac, 5).os, detect(UA.mac, 5).type], ["iOS", "tablet"]);
    assert.deepStrictEqual([detect(UA.mac, 0).os, detect(UA.mac, 0).type], ["macOS", "desktop"]);
});

type SentRequest = { via: string; url: string; init?: Record<string, unknown>; body?: string };

function runIdentify(withFetch: boolean): SentRequest[] {
    const sent: SentRequest[] = [];
    class FakeXhr {
        url = "";
        open(_method: string, url: string) { this.url = url; }
        setRequestHeader() {}
        send(body: string) { sent.push({ via: "xhr", url: this.url, body }); }
    }
    const ctx = vm.createContext({
        config: { apiKey: "k 1", identifyEndpoint: "https://sendb.test/api/tracker/identify" },
        getVisitorId: () => "v-1",
        XMLHttpRequest: FakeXhr,
        ...(withFetch
            ? {
                fetch: (url: string, init: Record<string, unknown>) => {
                    sent.push({ via: "fetch", url, init, body: String(init.body) });
                    return Promise.resolve({});
                },
            }
            : {}),
    });
    vm.runInContext(`${extractFunction("sendIdentify")}; sendIdentify({ email: "a@b.test", user_id: "u1" });`, ctx);
    return sent;
}

test("UX-219 sendIdentify: 페이지 이동에도 끝까지 가도록 keepalive fetch로 한 번만 보낸다", () => {
    const sent = runIdentify(true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].via, "fetch");
    assert.strictEqual(sent[0].url, "https://sendb.test/api/tracker/identify?key=k%201");
    assert.strictEqual(sent[0].init?.keepalive, true);
    assert.strictEqual(sent[0].init?.credentials, "omit");
    assert.strictEqual(sent[0].init?.mode, "cors");
    assert.deepStrictEqual(JSON.parse(sent[0].body!), { visitor_id: "v-1", email: "a@b.test", user_id: "u1" });
});

test("UX-219 sendIdentify: fetch가 없는 브라우저는 예전처럼 XHR", () => {
    const sent = runIdentify(false);
    assert.deepStrictEqual(sent.map((s) => s.via), ["xhr"]);
    assert.strictEqual(sent[0].url, "https://sendb.test/api/tracker/identify?key=k%201");
});
