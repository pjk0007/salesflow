/* eslint-disable @typescript-eslint/no-require-imports -- 배포 JS를 가상 DOM/메시지 이벤트로 검증 */
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    path = require("node:path");
const code = fs.readFileSync(
    path.join(__dirname, "../public/sendb-sdk.js"),
    "utf8",
);
function fixture(options = {}) {
    const messages = {},
        nodes = [],
        store = new Map(),
        timers = new Map(),
        posts = [];
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
                contentWindow: { postMessage: (value) => posts.push(value) },
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
        AbortSignal,
        fetch:
            options.fetch ??
            (() => {
                throw new Error("예상하지 않은 HTTP 호출");
            }),
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
    const session = (token) =>
        messages.message?.({
            source: active("iframe").contentWindow,
            origin: "https://sendb.example.test",
            data: { type: "sendb:session", key, token },
        });
    return {
        sdk: window.SendbChat,
        key,
        active,
        ready,
        timers,
        posts,
        session,
    };
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
            assert.equal(f.sdk.version, "1.3.0");
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
    await check(
        "첫 메시지 전 프로필/문구는 iframe 초안만 변경하고 빈 상담/HTTP 없음",
        async () => {
            const f = fixture();
            await assert.rejects(f.sdk.updateVisitorProfile({ name: "가상" }));
            const pending = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await pending;
            await f.sdk.updateVisitorProfile({
                name: " 가상 신청자 ",
                email: "lead@example.test",
            });
            f.sdk.setDraft("가상 도입 문의 초안");
            assert.deepEqual(JSON.parse(JSON.stringify(f.posts.at(-2))), {
                type: "sendb:visitor-profile",
                key: f.key,
                name: "가상 신청자",
                email: "lead@example.test",
            });
            assert.equal(f.posts.at(-1).type, "sendb:draft");
            assert.equal(f.posts.at(-1).message, "가상 도입 문의 초안");
            assert.throws(() => f.sdk.setDraft("a".repeat(5001)));
            await assert.rejects(
                f.sdk.updateVisitorProfile({ name: "가상", email: "wrong" }),
            );
            assert.equal(f.sdk.getSessionType(), "anonymous");
            f.sdk.shutdown();
        },
    );
    await check(
        "기존 익명 증명으로만 입력 정보 저장, 회원으로 승격하지 않음",
        async () => {
            const requests = [],
                f = fixture({
                    fetch: async (url, init) => {
                        requests.push({ url, init });
                        return {
                            ok: true,
                            json: async () => ({
                                success: true,
                                data: { identified: false },
                            }),
                        };
                    },
                });
            const pending = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await pending;
            f.session("b".repeat(64));
            await f.sdk.updateVisitorProfile({
                name: "가상",
                email: "lead@example.test",
            });
            assert.equal(requests.length, 1);
            assert.equal(
                requests[0].init.headers.Authorization,
                "Bearer " + "b".repeat(64),
            );
            assert.equal(JSON.parse(requests[0].init.body).action, "profile");
            assert.equal(requests[0].init.credentials, "omit");
            assert.equal(requests[0].init.redirect, "error");
            assert.equal(f.sdk.getSessionType(), "anonymous");
            f.sdk.shutdown();
        },
    );
    await check(
        "회원 연결은 비회원 입력 수정 불가, 종료된 연결의 늦은 저장도 적용 안 함",
        async () => {
            let resolve;
            const f = fixture({
                fetch: () =>
                    new Promise((r) => {
                        resolve = r;
                    }),
            });
            let pending = f.sdk.boot({
                channelKey: f.key,
                identityToken: "fictional-member-token",
            });
            f.ready();
            await pending;
            await assert.rejects(f.sdk.updateVisitorProfile({ name: "가상" }));
            pending = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await pending;
            f.session("b".repeat(64));
            const update = f.sdk.updateVisitorProfile({ name: "가상" });
            const before = f.posts.length;
            f.sdk.shutdown();
            resolve({ ok: true, json: async () => ({ success: true }) });
            await assert.rejects(update, /상담 연결이 변경/);
            assert.equal(f.posts.length, before);
        },
    );
    console.log(
        "Chat SDK 1.3.0 가상 DOM/실제 배포 JS QA " +
            checks +
            "개 통과 · 외부 전송 0건",
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
