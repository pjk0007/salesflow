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
        store = options.storage ?? new Map(),
        timers = new Map(),
        delays = new Map(),
        posts = [],
        destinations = [];
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
                contentWindow: {
                    postMessage: (value, origin) => {
                        posts.push(value);
                        destinations.push(origin);
                        if (value.type === "sendb:configure")
                            node.configurationId = value.configurationId;
                    },
                },
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
        DOMParser: options.DOMParser,
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
        setTimeout: (fn, delay) => {
            timers.set(++timerId, fn);
            delays.set(timerId, delay);
            return timerId;
        },
        clearTimeout: (id) => {
            timers.delete(id);
            delays.delete(id);
        },
    });
    const key = "a".repeat(48);
    const active = (tag) => nodes.findLast((n) => n.tag === tag && !n.removed);
    const dispatch = (
        type,
        extra = {},
        source = active("iframe")?.contentWindow,
        origin = "https://sendb.example.test",
    ) =>
        messages.message?.({
            source,
            origin,
            data: { type, key, ...extra },
        });
    const ready = (
        source = active("iframe")?.contentWindow,
        origin = "https://sendb.example.test",
    ) => {
        const frame = nodes.find((node) => node.contentWindow === source);
        if (!frame?.configurationId)
            dispatch("sendb:loaded", {}, source, origin);
        dispatch(
            "sendb:ready",
            { configurationId: frame?.configurationId },
            source,
            origin,
        );
    };
    const session = (token) => dispatch("sendb:session", { token });
    return {
        sdk: window.SendbChat,
        store,
        journey: (value) => {
            window.sendb = { getJourneyContext: () => value };
            messages["sendb:journey-context"]?.();
        },
        key,
        active,
        ready,
        timers,
        posts,
        destinations,
        dispatch,
        session,
        window,
        document,
        timeoutReady: () => {
            const value = [...timers].find(([id]) => delays.get(id) === 15000);
            assert.ok(value, "활성 준비 타임아웃이 필요합니다.");
            const [id, callback] = value;
            timers.delete(id);
            delays.delete(id);
            callback();
        },
    };
}
async function main() {
    let checks = 0;
    async function check(title, fn) {
        await fn();
        console.log("PASS CHAT SDK " + ++checks + " " + title);
    }
    // Stub only inert HTML serialization; native Chrome covers the real DOMParser/UI.
    class Parser {
        parseFromString(html) {
            const dataset = {}, bases = [], root = {
                dataset,
                get outerHTML() { return JSON.stringify({ html, dataset, bases }); },
            };
            return {
                documentElement: root,
                getElementById: () => html.includes('sendb-messenger-root') ? {} : null,
                querySelectorAll: () => [],
                createElement: () => ({}),
                head: { prepend: node => bases.push(node.href) },
            };
        }
    }
    const html = '<html><div id="sendb-messenger-root"></div></html>';
    const htmlResponse = () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const settle = () => new Promise(resolve => setImmediate(resolve));
    await check('사이트 내부 프레임은 공개 설정만 srcdoc에 넣고 메시지 origin과 API 목적지를 분리', async () => {
        const requests = [], f = fixture({ DOMParser: Parser, fetch: async (url, options) => { requests.push({url, options}); return htmlResponse(); } });
        assert.equal(f.sdk.supportsFirstPartyMessenger, true);
        const boot = f.sdk.boot({ apiBase: 'https://sendb.example.test', channelKey: f.key, messengerPath: '/sendb-messenger.html', identityToken: 'private-test-jwt' });
        await settle();
        assert.equal(requests[0].url, 'https://site.example.test/sendb-messenger.html');
        assert.equal(requests[0].options.credentials, 'omit');
        assert.equal(requests[0].options.redirect, 'error');
        assert.equal(requests[0].options.cache, 'no-store');
        const frame = f.active('iframe');
        assert.equal(frame.src, undefined);
        assert.ok(frame.srcdoc.includes('https://sendb.example.test'));
        assert.ok(!frame.srcdoc.includes('private-test-jwt'));
        f.ready(); assert.equal(frame.configurationId, undefined);
        f.ready(frame.contentWindow, 'https://site.example.test'); await boot;
        assert.equal(f.destinations.at(-1), 'https://site.example.test');
        assert.equal(f.posts.findLast(p => p.type === 'sendb:configure').identityToken, 'private-test-jwt');
        f.sdk.shutdown();
    });
    await check('외부 URL·상대 경로·HTML 외 파일·쿼리를 시작 전에 거절', async () => {
        for (const messengerPath of ['https://evil.test/a.html', '//evil.test/a.html', '/../../a.html', '/a.html?token=x', '/a.html#x', '/a.js', '/%2e%2e/a.html']) {
            const f = fixture();
            await assert.rejects(f.sdk.boot({channelKey:f.key, messengerPath}));
            assert.equal(f.active('iframe'), undefined);
        }
    });
    await check('HTML 실패 후 시작 상태를 해제하고 같은 고객이 재시도 가능', async () => {
        for (const response of [new Response('missing', {status:404}), new Response('{}', {headers:{'content-type':'application/json'}}), new Response('<html></html>', {headers:{'content-type':'text/html'}})]) {
            let attempt = 0;
            const f = fixture({DOMParser:Parser, fetch: async () => ++attempt === 1 ? response : htmlResponse()});
            await assert.rejects(f.sdk.boot({channelKey:f.key,messengerPath:'/sendb-messenger.html'}));
            assert.equal(f.sdk.getSessionType(),'uninitialized');
            const boot = f.sdk.boot({channelKey:f.key,messengerPath:'/sendb-messenger.html'}); await settle();
            f.ready(f.active('iframe').contentWindow, 'https://site.example.test'); await boot;
            assert.equal(f.sdk.getSessionType(),'anonymous'); f.sdk.shutdown();
        }
    });
    await check('늦게 도착한 이전 HTML이 새 회원 프레임과 설정을 교체하지 않음', async () => {
        let release;
        const delayed = new Promise(resolve => {release = resolve;});
        let count = 0;
        const f = fixture({DOMParser:Parser, fetch: async () => ++count === 1 ? delayed : htmlResponse()});
        const old = f.sdk.boot({channelKey:f.key,messengerPath:'/sendb-messenger.html',identityToken:'old-member'});
        const current = f.sdk.boot({channelKey:f.key,messengerPath:'/sendb-messenger.html',identityToken:'new-member'});
        await settle(); const frame = f.active('iframe');
        f.ready(frame.contentWindow,'https://site.example.test'); await current;
        release(htmlResponse()); await old;
        assert.equal(f.active('iframe'),frame);
        assert.equal(f.posts.findLast(p=>p.type==='sendb:configure').identityToken,'new-member');
        f.sdk.shutdown();
    });
    await check("첫 프레임이 준비 시간 초과 뒤 로드되어도 같은 프레임에서 자동 연결하고 옛 프레임은 거절", async () => {
        const f = fixture(), pending = f.sdk.boot({ channelKey: f.key }), frame = f.active("iframe");
        const failed = assert.rejects(pending, /상담창을 연결하지 못/);
        f.timeoutReady(); await failed;
        f.dispatch("sendb:loaded");
        assert.ok(frame.configurationId > 0);
        f.ready(); await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.active("iframe"), frame);
        assert.doesNotThrow(() => f.sdk.setDraft("늦게 연결된 문의 초안"));
        f.sdk.shutdown(); const before = f.posts.length;
        f.dispatch("sendb:loaded", {}, frame.contentWindow);
        assert.equal(f.posts.length, before);
    });
    await check("트래커의 경로 증명은 최초 설정과 늦은 수신 모두 iframe에 전달하며 회원으로 승격하지 않음", async () => {
        const f = fixture();
        f.journey("fictional-context-first");
        const ready = f.sdk.boot({ apiBase: "https://sendb.example.test", channelKey: f.key });
        f.ready(); await ready;
        assert.equal(f.posts.findLast(p => p.type === "sendb:configure").journeyToken, "fictional-context-first");
        f.journey("fictional-context-later");
        assert.equal(f.posts.at(-1).type, "sendb:journey-context");
        assert.equal(f.posts.at(-1).journeyToken, "fictional-context-later");
        assert.equal(f.sdk.getSessionType(), "anonymous");
        f.sdk.shutdown(); const count = f.posts.length; f.journey("after-shutdown"); assert.equal(f.posts.length, count);
    });
    await check(
        "시작 전과 종료 후 세션 상태·버튼 제어는 인증 정보를 노출하지 않음",
        async () => {
            const f = fixture();
            assert.equal(f.sdk.version, "1.6.1");
            assert.equal(f.sdk.getSessionType(), "uninitialized");
            f.sdk.hideLauncher();
            f.sdk.showLauncher();
            f.sdk.shutdown();
            assert.equal(f.sdk.getSessionType(), "uninitialized");
        },
    );
    await check(
        "보호된 첨부 다운로드를 허용하면서 iframe의 기존 sandbox 범위를 유지",
        async () => {
            const f = fixture(),
                pending = f.sdk.boot({ channelKey: f.key });
            assert.deepEqual(
                f.active("iframe").attributes.sandbox.split(/\s+/).sort(),
                ["allow-downloads", "allow-forms", "allow-same-origin", "allow-scripts"],
            );
            f.ready();
            await pending;
            f.sdk.shutdown();
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
    await check(
        "연결 전·준비 전·종료 후 탐색은 호출을 보관하거나 창을 열지 않음",
        async () => {
            const f = fixture(),
                id = "2fc0908a-3fbb-49f7-b329-ae485409a71e",
                calls = [
                    () => f.sdk.showConversations(),
                    () => f.sdk.showNewConversation(),
                    () => f.sdk.showConversation(id),
                ];
            calls.forEach((call) => assert.throws(call, /회원 상담 연결/));
            const pending = f.sdk.boot({
                channelKey: f.key,
                identityToken: "fictional-member-A-token",
            });
            calls.forEach((call) => assert.throws(call, /회원 상담 연결/));
            assert.equal(f.posts.length, 0);
            f.ready();
            await pending;
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:navigate").length,
                0,
            );
            assert.equal(f.active("iframe").style.display, undefined);
            f.sdk.shutdown();
            calls.forEach((call) => assert.throws(call, /회원 상담 연결/));
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:navigate").length,
                0,
            );
        },
    );
    await check(
        "비회원 탐색은 세션·초안·창을 보존하고 기존 show는 계속 사용 가능",
        async () => {
            const f = fixture(),
                pending = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await pending;
            f.session("b".repeat(64));
            f.sdk.setDraft("비회원이 이미 쓰던 가상 문의");
            f.sdk.hide();
            const frame = f.active("iframe"),
                previous = f.posts.length;
            [
                () => f.sdk.showConversations(),
                () => f.sdk.showNewConversation(),
                () =>
                    f.sdk.showConversation(
                        "2fc0908a-3fbb-49f7-b329-ae485409a71e",
                    ),
            ].forEach((call) => assert.throws(call, /로그인한 회원/));
            assert.equal(f.posts.length, previous);
            assert.equal(f.active("iframe"), frame);
            assert.equal(frame.style.display, "none");
            assert.equal(f.sdk.getSessionType(), "anonymous");
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            f.sdk.show();
            assert.equal(frame.style.display, "block");
            f.sdk.shutdown();
        },
    );
    await check(
        "회원의 목록·새 문의·개별 문의는 정확한 iframe 출처로 탐색 뒤 표시",
        async () => {
            const f = fixture(),
                pending = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                    hideLauncher: true,
                }),
                id = "2FC0908A-3FBB-49F7-B329-AE485409A71E",
                values = [
                    { call: () => f.sdk.showConversations(), view: "list" },
                    { call: () => f.sdk.showNewConversation(), view: "new" },
                    {
                        call: () => f.sdk.showConversation(id),
                        view: "thread",
                        conversationId: id,
                    },
                ];
            f.ready();
            await pending;
            const frame = f.active("iframe");
            f.sdk.setDraft("회원이 준비한 가상 문의");
            for (const value of values) {
                f.sdk.hide();
                value.call();
                assert.deepEqual(
                    JSON.parse(JSON.stringify(f.posts.at(-2))),
                    {
                        type: "sendb:navigate",
                        key: f.key,
                        view: value.view,
                        configurationId: frame.configurationId,
                        ...(value.conversationId
                            ? { conversationId: value.conversationId }
                            : {}),
                    },
                );
                assert.deepEqual(JSON.parse(JSON.stringify(f.posts.at(-1))), {
                    type: "sendb:visibility",
                    key: f.key,
                    opened: true,
                });
                assert.equal(f.destinations.at(-2), "https://sendb.example.test");
                assert.equal(f.destinations.at(-1), "https://sendb.example.test");
                assert.equal(f.active("iframe"), frame);
                assert.equal(frame.style.display, "block");
                assert.equal(f.active("button").hidden, true);
                assert.equal(f.active("button").attributes["aria-expanded"], "true");
            }
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            f.sdk.shutdown();
        },
    );
    await check(
        "잘못된 개별 문의 ID는 메시지·창·기존 초안을 바꾸지 않음",
        async () => {
            const f = fixture(),
                pending = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.ready();
            await pending;
            f.sdk.setDraft("보존할 가상 문구");
            f.sdk.hide();
            const before = f.posts.length;
            [
                undefined,
                null,
                123,
                {},
                "",
                "not-a-uuid",
                "2fc0908a-3fbb-09f7-b329-ae485409a71e",
                "2fc0908a-3fbb-49f7-c329-ae485409a71e",
                "https://site.example.test/thread",
                "2fc0908a-3fbb-49f7-b329-ae485409a71e?x=1",
                " 2fc0908a-3fbb-49f7-b329-ae485409a71e ",
            ].forEach((id) =>
                assert.throws(() => f.sdk.showConversation(id), /문의 ID/),
            );
            assert.equal(f.posts.length, before);
            assert.equal(f.active("iframe").style.display, "none");
            assert.equal(f.sdk.getSessionType(), "member");
            f.sdk.shutdown();
        },
    );
    await check(
        "비회원 이력 병합 중과 새 회원 확인 전 탐색은 전송하지 않음",
        async () => {
            let respond;
            const f = fixture({
                    fetch: () =>
                        new Promise((resolve) => {
                            respond = resolve;
                        }),
                }),
                boot = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await boot;
            f.session("b".repeat(64));
            f.sdk.setDraft("로그인 전 쓰던 가상 문구");
            f.sdk.hide();
            const pending = f.sdk.identify("fictional-member-A-token", {
                    mergeAnonymous: true,
                }),
                before = f.posts.length;
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            assert.throws(() => f.sdk.showNewConversation(), /회원 상담 연결/);
            assert.equal(f.posts.length, before);
            respond({ ok: true, json: async () => ({ success: true }) });
            await new Promise((resolve) => setImmediate(resolve));
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            assert.equal(f.active("iframe").style.display, "none");
            f.ready();
            await pending;
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:navigate").length,
                0,
            );
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).view, "list");
            f.sdk.shutdown();
        },
    );
    await check(
        "인증 갱신 중 탐색 차단·준비 후 새 호출만 전달하며 초안 유지",
        async () => {
            let resolveIdentity;
            const f = fixture(),
                boot = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                    getIdentityToken: () =>
                        new Promise((resolve) => {
                            resolveIdentity = resolve;
                        }),
                });
            f.ready();
            await boot;
            const frame = f.active("iframe");
            const previousConfigurationId = frame.configurationId;
            f.sdk.setDraft("인증 갱신 중에도 보존할 문구");
            f.sdk.hide();
            f.dispatch("sendb:refresh");
            const before = f.posts.length;
            assert.throws(() => f.sdk.showNewConversation(), /회원 상담 연결/);
            assert.equal(f.posts.length, before);
            resolveIdentity("fictional-refreshed-member-A-token");
            await new Promise((resolve) => setImmediate(resolve));
            f.dispatch("sendb:ready", {
                configurationId: previousConfigurationId,
            });
            assert.throws(() => f.sdk.showNewConversation(), /회원 상담 연결/);
            f.ready();
            assert.equal(f.active("iframe"), frame);
            assert.equal(frame.style.display, "none");
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:navigate").length,
                0,
            );
            f.sdk.showNewConversation();
            assert.equal(f.posts.at(-2).view, "new");
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            f.sdk.shutdown();
        },
    );
    await check(
        "A 갱신이 늦게 끝나도 B 새 연결에는 이전 탐색·인증을 전달하지 않음",
        async () => {
            let resolveIdentity;
            const f = fixture(),
                first = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                    getIdentityToken: () =>
                        new Promise((resolve) => {
                            resolveIdentity = resolve;
                        }),
                });
            f.ready();
            await first;
            const previous = f.active("iframe").contentWindow;
            f.dispatch("sendb:refresh");
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            const next = f.sdk.boot({
                channelKey: f.key,
                identityToken: "fictional-member-B-token",
            });
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            resolveIdentity("fictional-refreshed-member-A-token");
            await new Promise((resolve) => setImmediate(resolve));
            f.ready(previous);
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.dispatch("sendb:loaded");
            assert.equal(f.posts.at(-1).identityToken, "fictional-member-B-token");
            f.ready();
            await next;
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:navigate").length,
                0,
            );
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).view, "list");
            f.sdk.shutdown();
        },
    );
    await check(
        "현재 configurationId가 없는 준비 신호·이전 설정 ACK는 부팅을 완료하지 않음",
        async () => {
            const f = fixture(),
                pending = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.dispatch("sendb:loaded");
            const id = f.posts.at(-1).configurationId;
            assert.ok(Number.isSafeInteger(id) && id > 0);
            f.dispatch("sendb:ready");
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.dispatch("sendb:ready", { configurationId: id - 1 });
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.ready();
            await pending;
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).configurationId, id);
            f.sdk.shutdown();
        },
    );
    await check(
        "부팅 전·진행 중 중복 연결 거절, 첫 준비 실패 뒤 reconnect로 현재 프레임 복구",
        async () => {
            const f = fixture();
            await assert.rejects(f.sdk.reconnect(), /연결을 먼저 완료/);
            await assert.rejects(
                f.sdk.identify("fictional-member-A-token"),
                /연결을 먼저 완료/,
            );
            const pending = f.sdk.boot({ channelKey: f.key }),
                failed = assert.rejects(pending, /상담창을 연결하지 못했습니다/);
            f.dispatch("sendb:loaded");
            const before = f.posts.length;
            await assert.rejects(f.sdk.reconnect(), /연결하고 있습니다/);
            await assert.rejects(
                f.sdk.identify("fictional-member-A-token"),
                /연결을 먼저 완료/,
            );
            f.timeoutReady();
            await failed;
            f.ready();
            assert.throws(() => f.sdk.setDraft("부팅 실패"), /상담 연결 후/);
            assert.equal(f.posts.length, before);
            const frame = f.active("iframe"),
                recovered = f.sdk.reconnect();
            f.ready();
            await recovered;
            assert.equal(f.active("iframe"), frame);
            f.sdk.setDraft("첫 준비 실패 뒤 복구한 초안");
            f.sdk.shutdown();
        },
    );
    await check(
        "최초 회원 토큰을 받는 동안 프레임 없는 reconnect는 이전 연결을 만들지 않음",
        async () => {
            let resolveIdentity;
            const f = fixture(),
                pending = f.sdk.boot({
                    channelKey: f.key,
                    getIdentityToken: () => new Promise((resolve) => {
                        resolveIdentity = resolve;
                    }),
                });
            assert.equal(f.active("iframe"), undefined);
            await assert.rejects(f.sdk.reconnect(), /연결을 먼저 완료/);
            assert.equal(f.posts.length, 0);
            resolveIdentity("fictional-member-A-token");
            await new Promise((resolve) => setImmediate(resolve));
            f.ready();
            await pending;
            f.sdk.shutdown();
        },
    );
    await check(
        "identify 타임아웃 뒤 reconnect는 같은 인증·iframe·초안을 유지하고 새 ACK만 수락",
        async () => {
            const f = fixture(),
                boot = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.ready();
            await boot;
            const frame = f.active("iframe");
            f.sdk.setDraft("준비 실패 뒤에도 보존할 실제 SDK 문구");
            f.sdk.hide();
            const pending = f.sdk.identify("fictional-refreshed-member-A-token"),
                failed = assert.rejects(pending, /회원 상담 인증을 확인하지 못/),
                previousId = frame.configurationId;
            await assert.rejects(f.sdk.reconnect(), /연결하고 있습니다/);
            await assert.rejects(
                f.sdk.identify("fictional-competing-token"),
                /연결하고 있습니다/,
            );
            f.timeoutReady();
            await failed;
            f.dispatch("sendb:ready", { configurationId: previousId });
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            const reconnect = f.sdk.reconnect(),
                nextId = frame.configurationId,
                configuration = f.posts.at(-1);
            assert.ok(nextId > previousId);
            assert.equal(configuration.type, "sendb:configure");
            assert.equal(configuration.identityToken, "fictional-refreshed-member-A-token");
            assert.equal(configuration.continueAnonymous, false);
            assert.equal(f.active("iframe"), frame);
            assert.equal(frame.style.display, "none");
            f.dispatch("sendb:ready", { configurationId: previousId });
            f.dispatch("sendb:ready");
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.ready();
            await reconnect;
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).configurationId, nextId);
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            f.sdk.shutdown();
        },
    );
    await check(
        "identify와 reconnect 각각의 타임아웃 뒤 identify를 다시 시도할 수 있음",
        async () => {
            const f = fixture(),
                boot = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.ready();
            await boot;
            const frame = f.active("iframe");
            for (const attempt of [
                () => f.sdk.identify("fictional-refreshed-member-A-token"),
                () => f.sdk.reconnect(),
            ]) {
                const pending = attempt(),
                    failed = assert.rejects(pending, /인증을 확인하지 못/),
                    previousId = frame.configurationId;
                f.timeoutReady();
                await failed;
                const retry = f.sdk.identify("fictional-current-member-A-token");
                assert.ok(frame.configurationId > previousId);
                f.dispatch("sendb:ready", { configurationId: previousId });
                assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
                f.ready();
                await retry;
                assert.equal(f.active("iframe"), frame);
            }
            f.sdk.shutdown();
        },
    );
    await check(
        "재연결 중 A→B 부팅은 A 준비 Promise를 종료하고 옛 ACK를 B에게 적용하지 않음",
        async () => {
            const f = fixture(),
                first = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.ready();
            await first;
            const previous = f.active("iframe").contentWindow,
                reconnect = f.sdk.reconnect(),
                cancelled = assert.rejects(reconnect, /연결이 종료되었습니다/),
                second = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-B-token",
                });
            await cancelled;
            f.ready(previous);
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.ready();
            await second;
            const configuration = f.posts.findLast(
                (value) => value.type === "sendb:configure",
            );
            assert.equal(configuration.identityToken, "fictional-member-B-token");
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).configurationId, configuration.configurationId);
            f.sdk.shutdown();
        },
    );
    await check(
        "열린 iframe의 재로드는 같은 연결을 재검증하며 오래된 ACK로 탐색을 풀지 않음",
        async () => {
            const f = fixture(),
                boot = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.ready();
            await boot;
            f.sdk.setDraft("재로드 전 문구");
            const frame = f.active("iframe"),
                previousId = frame.configurationId;
            f.dispatch("sendb:loaded");
            assert.ok(frame.configurationId > previousId);
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.dispatch("sendb:ready", { configurationId: previousId });
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.ready();
            f.sdk.showConversations();
            assert.equal(f.active("iframe"), frame);
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            f.sdk.shutdown();
        },
    );
    await check(
        "옛 설정 오류는 현재 회원에 적용하지 않고 갱신 함수 없는 인증 오류도 수동 identify 복구",
        async () => {
            const f = fixture(),
                errors = [],
                boot = f.sdk.boot({
                    channelKey: f.key,
                    identityToken: "fictional-member-A-token",
                });
            f.sdk.on("error", (error) => errors.push(error));
            f.ready();
            await boot;
            const previousId = f.active("iframe").configurationId,
                update = f.sdk.identify("fictional-refreshed-member-A-token");
            f.ready();
            await update;
            f.dispatch("sendb:error", {
                status: 401,
                configurationId: previousId,
            });
            f.sdk.showConversations();
            assert.equal(errors.length, 0);
            f.dispatch("sendb:refresh");
            assert.equal(errors.at(-1).code, "identity_refresh_required");
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            const retry = f.sdk.identify("fictional-current-member-A-token");
            f.ready();
            await retry;
            f.sdk.showConversations();
            f.sdk.shutdown();
        },
    );
    await check(
        "만료된 비회원 증명은 제거하고 새 준비 ACK까지 입력 제어를 기다림",
        async () => {
            const f = fixture(),
                boot = f.sdk.boot({ channelKey: f.key });
            f.ready();
            await boot;
            f.session("b".repeat(64));
            f.dispatch("sendb:read", { readId: 500 });
            const frame = f.active("iframe"),
                previousId = frame.configurationId;
            f.dispatch("sendb:error", {
                status: 401,
                configurationId: previousId,
            });
            assert.equal(f.active("iframe"), frame);
            assert.equal(f.posts.at(-1).type, "sendb:configure");
            assert.equal(f.posts.at(-1).visitorToken, undefined);
            assert.equal(f.posts.at(-1).readId, 0);
            assert.ok(frame.configurationId > previousId);
            assert.throws(() => f.sdk.setDraft("아직 준비 중"), /상담 연결 후/);
            f.dispatch("sendb:ready", { configurationId: previousId });
            assert.throws(() => f.sdk.setDraft("아직 준비 중"), /상담 연결 후/);
            f.ready();
            f.sdk.setDraft("새 비회원 준비 뒤 초안");
            assert.equal(f.sdk.getSessionType(), "anonymous");
            f.sdk.shutdown();
        },
    );
    await check("비회원 읽음은 재방문·같은 세션 재부팅에서 유지하고 새 세션에는 넘기지 않음", async () => {
        const storage = new Map(), first = fixture({ storage });
        const firstBoot = first.sdk.boot({ channelKey: first.key });
        first.ready(); await firstBoot;
        first.session("b".repeat(64));
        first.dispatch("sendb:read", { readId: 123 });
        const revisited = fixture({ storage });
        const revisitBoot = revisited.sdk.boot({ channelKey: revisited.key });
        revisited.ready(); await revisitBoot;
        assert.equal(revisited.posts.findLast((p) => p.type === "sendb:configure").readId, 123);
        const sameSession = revisited.sdk.boot({ channelKey: revisited.key });
        revisited.ready(); await sameSession;
        assert.equal(revisited.posts.findLast((p) => p.type === "sendb:configure").readId, 123);
        revisited.session("c".repeat(64));
        const reconnect = revisited.sdk.reconnect(); revisited.ready(); await reconnect;
        assert.equal(revisited.posts.findLast((p) => p.type === "sendb:configure").readId, 0);
        revisited.dispatch("sendb:read", { readId: 321 });
        const identify = revisited.sdk.identify("fictional-member-token"); revisited.ready(); await identify;
        assert.equal(storage.has("sendb-chat-read:" + revisited.key), false);
        revisited.sdk.shutdown(); first.sdk.shutdown();
    });
    console.log(
        "Chat SDK 1.6.1 가상 DOM/실제 배포 JS QA " +
            checks +
            "개 통과 · 외부 전송 0건",
    );
}
module.exports = { fixture };
if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
