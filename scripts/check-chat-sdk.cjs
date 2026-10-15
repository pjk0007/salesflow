/* eslint-disable @typescript-eslint/no-require-imports -- 배포 JS를 가상 DOM/메시지 이벤트로 검증 */
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    path = require("node:path");
const code = fs.readFileSync(
    path.join(__dirname, "../public/sendb-sdk.js"),
    "utf8",
);
function fixture() {
    const messages = {},
        nodes = [],
        store = new Map(),
        timers = new Map();
    let timerId = 0;
    const window = {
        addEventListener: (name, fn) => {
            messages[name] = fn;
        },
        removeEventListener: (name) => {
            delete messages[name];
        },
    };
    const document = {
        currentScript: {
            src: "https://sendb.example.test/sendb-sdk.js",
            dataset: {},
        },
        createElement: (tag) => {
            const node = {
                tag,
                style: {},
                attributes: {},
                hidden: false,
                contentWindow: { postMessage: () => {} },
                setAttribute(key, value) {
                    this.attributes[key] = value;
                },
                addEventListener() {},
                remove() {
                    this.removed = true;
                },
            };
            return node;
        },
        body: {
            appendChild: (node) => {
                nodes.push(node);
            },
        },
    };
    vm.runInNewContext(code, {
        window,
        document,
        location: { origin: "https://site.example.test", pathname: "/" },
        URL,
        console,
        localStorage: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => store.set(key, value),
            removeItem: (key) => store.delete(key),
        },
        setTimeout: (fn) => {
            timers.set(++timerId, fn);
            return timerId;
        },
        clearTimeout: (id) => timers.delete(id),
    });
    const key = "a".repeat(48);
    const active = (tag) => nodes.findLast((n) => n.tag === tag && !n.removed);
    const ready = (
        source = active("iframe")?.contentWindow,
        origin = "https://sendb.example.test",
    ) =>
        messages.message?.({
            source,
            origin,
            data: { type: "sendb:ready", key },
        });
    return { sdk: window.SendbChat, key, active, ready, timers };
}
async function main() {
    let checks = 0;
    async function check(title, fn) {
        await fn();
        console.log("PASS CHAT SDK " + ++checks + " " + title);
    }
    await check(
        "시작 전과 종료 후 세션 상태·버튼 제어는 인증 정보를 노출하지 않음",
        async () => {
            const f = fixture();
            assert.equal(f.sdk.version, "1.2.0");
            assert.equal(f.sdk.getSessionType(), "uninitialized");
            f.sdk.hideLauncher();
            f.sdk.showLauncher();
            f.sdk.shutdown();
            assert.equal(f.sdk.getSessionType(), "uninitialized");
        },
    );
    await check(
        "숨김 옵션은 첫 삽입부터 적용하고 명시적 문의 열기와 독립",
        async () => {
            const f = fixture(),
                promise = f.sdk.boot({ channelKey: f.key, hideLauncher: true });
            assert.equal(f.active("button").hidden, true);
            assert.equal(f.active("button").style.display, "none");
            f.ready();
            await promise;
            f.sdk.show();
            assert.equal(f.active("iframe").style.display, "block");
            assert.equal(f.active("button").hidden, true);
            f.sdk.showLauncher();
            assert.equal(f.active("button").hidden, false);
            assert.equal(f.active("button").style.display, "");
            f.sdk.hideLauncher();
            f.sdk.hide();
            assert.equal(f.active("button").hidden, true);
            assert.equal(f.active("button").style.display, "none");
            assert.equal(f.active("iframe").style.display, "none");
            f.sdk.shutdown();
        },
    );
    await check(
        "비회원→회원 인증 확인과 종료 상태는 공개 세션 종류만 반환",
        async () => {
            const f = fixture(),
                boot = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await boot;
            assert.equal(f.sdk.getSessionType(), "anonymous");
            const identity = f.sdk.identify("fictional-member-token");
            assert.equal(f.sdk.getSessionType(), "member");
            f.ready();
            await identity;
            f.sdk.shutdown();
            assert.equal(f.sdk.getSessionType(), "uninitialized");
            assert.equal(f.active("iframe"), undefined);
            assert.equal(f.timers.size, 0);
        },
    );
    await check(
        "다른 origin/옛 iframe의 준비 메시지는 새 연결을 완료하지 못함",
        async () => {
            const f = fixture();
            let ready = false;
            const first = f.sdk.boot({ channelKey: f.key });
            const previous = f.active("iframe").contentWindow;
            f.ready();
            await first;
            const second = f.sdk
                .boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-token",
                })
                .then(() => {
                    ready = true;
                });
            f.ready(previous);
            f.ready(
                f.active("iframe").contentWindow,
                "https://other.example.test",
            );
            await Promise.resolve();
            assert.equal(ready, false);
            f.ready();
            await second;
            assert.equal(ready, true);
            f.sdk.shutdown();
        },
    );
    console.log(
        "Chat SDK 1.2.0 가상 DOM/실제 배포 JS QA " +
            checks +
            "개 통과 · 외부 전송 0건",
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
