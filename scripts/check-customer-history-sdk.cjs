/* eslint-disable @typescript-eslint/no-require-imports -- 실제 디하 소스와 배포 SDK를 외부 접속 없이 VM으로 연결 */
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript");
const { fixture } = require("./check-chat-sdk.cjs");
const siteDirectory = process.argv[2];
if (!siteDirectory || !path.isAbsolute(siteDirectory))
    throw new Error("디자이너하이어 웹 소스의 절대 경로를 전달해주세요.");
const siteFeature = path.join(
    siteDirectory,
    "src/components/support-chat/sendb",
);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const session = (uid) => ({
    ready: true,
    user: uid ? { uid, getIdToken: async () => "firebase:" + uid } : null,
});
function setup(options = {}) {
    const sdkRequests = [],
        identityRequests = [],
        f = fixture({
            fetch: async (url, init) => {
                const body = JSON.parse(init.body);
                assert.equal(body.action, "identify");
                sdkRequests.push({ url, init, body });
                return Response.json({ success: true, data: { linked: true } });
            },
        }),
        modules = new Map(),
        config = {
            apiBase: "https://sendb.example.test",
            identityUrl: "https://identity.example.test/support/identity",
            channelKey: f.key,
        };
    function load(name) {
        if (modules.has(name)) return modules.get(name);
        assert.ok(["controller", "api", "loader"].includes(name));
        const filename = path.join(siteFeature, name + ".ts"),
            source = fs.readFileSync(filename, "utf8"),
            compiled = ts.transpileModule(source, {
                fileName: filename,
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES2022,
                },
            }).outputText,
            evaluated = { exports: {} };
        const factory = vm.runInNewContext(
            "(function(require,module,exports){" + compiled + "\n})",
            {
                window: f.window,
                document: f.document,
                Headers,
                Response,
                URL,
                AbortSignal,
                setTimeout,
                clearTimeout,
                fetch: () => {
                    throw new Error("실제 HTTP 호출은 허용하지 않습니다.");
                },
            },
            { filename },
        );
        factory(
            (specifier) => {
                if (specifier === "@/components/support-chat/sendb/api")
                    return load("api");
                throw new Error("예상하지 않은 모듈: " + specifier);
            },
            evaluated,
            evaluated.exports,
        );
        modules.set(name, evaluated.exports);
        return evaluated.exports;
    }
    const { SupportController } = load("controller"),
        { loadSupportSdk } = load("loader"),
        controller = new SupportController({
            config: () => config,
            load: loadSupportSdk,
            transport: async (url, init) => {
                assert.equal(url, config.identityUrl);
                const authorization = new Headers(init.headers).get("Authorization"),
                    uid = authorization.split(":").at(-1);
                identityRequests.push({ uid, init });
                if (options.transport) return options.transport(uid, init);
                return Response.json({
                    success: true,
                    data: {
                        identityToken: "fictional-member-" + uid,
                        expiresAt: new Date(Date.now() + 900000).toISOString(),
                        channelKey: f.key,
                    },
                });
            },
        });
    return { f, controller, sdkRequests, identityRequests, loadSupportSdk };
}
async function connect(context, uid) {
    const pending = context.controller.connect(session(uid));
    await tick();
    context.f.ready();
    await pending;
    assert.equal(context.controller.getSnapshot().state, "ready");
}
async function main() {
    let checks = 0;
    async function check(title, fn) {
        await fn();
        console.log("PASS CUSTOMER HISTORY SDK " + ++checks + " " + title);
    }
    await check(
        "실제 디하 loader·컨트롤러가 SDK1.6 비회원 연결·열기·숨김을 유지",
        async () => {
            const ctx = setup(),
                { f, controller } = ctx;
            assert.equal(await ctx.loadSupportSdk("https://sendb.example.test"), f.sdk);
            await connect(ctx, null);
            assert.equal(f.sdk.version, "1.6.1");
            assert.equal(f.sdk.getSessionType(), "anonymous");
            controller.setLauncherHidden("guide", true);
            await controller.open();
            assert.equal(f.active("iframe").style.display, "block");
            assert.equal(f.active("button").hidden, true);
            assert.throws(() => f.sdk.showConversations(), /로그인한 회원/);
            assert.equal(ctx.identityRequests.length, 0);
            assert.equal(ctx.sdkRequests.length, 0);
            controller.destroy();
        },
    );
    await check(
        "실제 디하 첫 로그인 병합 후 동일 iframe에서 목록·새 문의·상세 탐색",
        async () => {
            const ctx = setup(),
                { f, controller } = ctx;
            await connect(ctx, null);
            f.session("b".repeat(64));
            f.sdk.setDraft("가상 로그인 전에 준비한 문의");
            const frame = f.active("iframe");
            await connect(ctx, "A");
            assert.equal(f.active("iframe"), frame);
            assert.equal(ctx.sdkRequests.length, 1);
            assert.equal(ctx.sdkRequests[0].body.anonymousToken, "b".repeat(64));
            assert.equal(ctx.sdkRequests[0].init.headers.Authorization, "Bearer fictional-member-A");
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).view, "list");
            f.sdk.showNewConversation();
            assert.equal(f.posts.at(-2).view, "new");
            f.sdk.showConversation("2fc0908a-3fbb-49f7-b329-ae485409a71e");
            assert.equal(f.posts.at(-2).view, "thread");
            assert.equal(f.posts.at(-2).configurationId, frame.configurationId);
            assert.equal(ctx.sdkRequests.length, 1);
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            controller.destroy();
        },
    );
    await check(
        "실제 같은 회원의 SDK 준비 실패 뒤 재시도는 iframe·초안을 보존하며 복구",
        async () => {
            const ctx = setup(),
                { f, controller } = ctx;
            await connect(ctx, "A");
            const frame = f.active("iframe");
            f.sdk.setDraft("회원 인증 대기 중 작성한 가상 문의");
            const first = controller.retry();
            await tick();
            f.timeoutReady();
            await first;
            assert.equal(controller.getSnapshot().state, "error");
            assert.equal(f.active("iframe"), frame);
            const recovered = controller.retry();
            await tick();
            f.ready();
            await recovered;
            assert.equal(controller.getSnapshot().state, "ready");
            assert.equal(f.active("iframe"), frame);
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).view, "list");
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            controller.destroy();
        },
    );
    await check(
        "늦은 A 인증은 실제 B 연결에 적용되지 않고 로그아웃 뒤 회원 탐색 거절",
        async () => {
            let resolveA;
            const ctx = setup({
                    transport: async (uid) => {
                        if (uid === "A")
                            return new Promise((resolve) => {
                                resolveA = resolve;
                            });
                        return Response.json({
                            success: true,
                            data: {
                                identityToken: "fictional-member-" + uid,
                                expiresAt: new Date(Date.now() + 900000).toISOString(),
                                channelKey: "a".repeat(48),
                            },
                        });
                    },
                }),
                { f, controller } = ctx,
                first = controller.connect(session("A"));
            await tick();
            await connect(ctx, "B");
            const frame = f.active("iframe");
            resolveA(Response.json({
                success: true,
                data: {
                    identityToken: "fictional-member-A",
                    expiresAt: new Date(Date.now() + 900000).toISOString(),
                    channelKey: f.key,
                },
            }));
            await first;
            assert.equal(f.active("iframe"), frame);
            assert.equal(
                f.posts.findLast((value) => value.type === "sendb:configure").identityToken,
                "fictional-member-B",
            );
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).view, "list");
            await connect(ctx, null);
            assert.notEqual(f.active("iframe"), frame);
            assert.equal(frame.removed, true);
            assert.equal(f.sdk.getSessionType(), "anonymous");
            assert.throws(() => f.sdk.showConversations(), /로그인한 회원/);
            assert.equal(ctx.sdkRequests.length, 0);
            controller.destroy();
        },
    );
    await check(
        "실제 비회원 첫 준비 실패도 reconnect로 같은 iframe에서 재시도",
        async () => {
            const ctx = setup(),
                { f, controller } = ctx,
                pending = controller.connect(session(null));
            await tick();
            const frame = f.active("iframe");
            assert.ok(frame);
            f.dispatch("sendb:loaded");
            f.timeoutReady();
            await pending;
            assert.equal(controller.getSnapshot().state, "error");
            const previousId = frame.configurationId,
                retry = controller.retry();
            await tick();
            assert.equal(f.active("iframe"), frame);
            assert.ok(frame.configurationId > previousId);
            f.ready();
            await retry;
            assert.equal(controller.getSnapshot().state, "ready");
            assert.equal(f.active("iframe"), frame);
            f.sdk.setDraft("초기 확인 실패 뒤 입력한 가상 문의");
            controller.destroy();
        },
    );
    await check(
        "실제 비회원 reconnect 중 로그인은 준비가 끝난 뒤 명시적 병합하며 초안 유지",
        async () => {
            const ctx = setup(),
                { f, controller } = ctx;
            await connect(ctx, null);
            const frame = f.active("iframe");
            f.session("b".repeat(64));
            f.sdk.setDraft("비회원 재연결 도중에도 보존할 문구");
            const retry = controller.retry();
            await tick();
            const login = controller.connect(session("A"));
            await tick();
            assert.equal(ctx.identityRequests.length, 0);
            assert.throws(() => f.sdk.showConversations(), /회원 상담 연결/);
            f.ready();
            await retry;
            await tick();
            assert.equal(ctx.identityRequests.length, 1);
            assert.equal(ctx.sdkRequests.length, 1);
            assert.equal(ctx.sdkRequests[0].body.anonymousToken, "b".repeat(64));
            f.ready();
            await login;
            assert.equal(controller.getSnapshot().state, "ready");
            assert.equal(f.active("iframe"), frame);
            assert.equal(f.sdk.getSessionType(), "member");
            f.sdk.showConversations();
            assert.equal(f.posts.at(-2).view, "list");
            assert.equal(
                f.posts.filter((value) => value.type === "sendb:draft").length,
                1,
            );
            controller.destroy();
        },
    );
    await check("첫 프레임의 늦은 로드가 오류 화면을 자동 해제하고 기존 비회원과 로그인 병합을 유지", async () => {
        const ctx = setup(), { f, controller } = ctx;
        const pending = controller.connect(session(null)); await tick();
        const frame = f.active("iframe");
        f.timeoutReady(); await pending;
        assert.equal(controller.getSnapshot().state, "error");
        f.dispatch("sendb:loaded"); f.ready(); await tick();
        assert.equal(controller.getSnapshot().state, "ready");
        assert.equal(f.active("iframe"), frame);
        f.session("b".repeat(64)); f.sdk.setDraft("늦은 연결 후에도 보관할 초안");
        const login = controller.connect(session("A")); await tick();
        assert.equal(ctx.sdkRequests.length, 1);
        assert.equal(ctx.sdkRequests[0].body.anonymousToken, "b".repeat(64));
        f.ready(); await login;
        assert.equal(f.active("iframe"), frame);
        assert.equal(f.sdk.getSessionType(), "member");
        assert.equal(controller.getSnapshot().state, "ready");
        controller.destroy();
    });
    console.log(
        "실제 디하 adapter·실제 SDK1.6 교차 VM QA " + checks +
            "개 통과 · 가상 인증/HTTP만 사용 · 외부 접속 0건",
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
