/* Sendb Chat SDK v1. 브라우저에는 서비스 API 토큰을 넣지 않습니다. */
(function () {
    "use strict";
    if (window.SendbChat && window.SendbChat.version) return;
    var script = document.currentScript,
        current = null,
        listeners = {},
        sequence = 0;
    function store(key, value) {
        try {
            if (value === null) localStorage.removeItem(key);
            else if (value !== undefined) localStorage.setItem(key, value);
            else return localStorage.getItem(key);
        } catch {}
        return null;
    }
    function emit(type, value) {
        (listeners[type] || []).forEach(function (fn) {
            try {
                fn(value);
            } catch {}
        });
        if (
            current &&
            typeof current.options[
                "on" + type[0].toUpperCase() + type.slice(1)
            ] === "function"
        )
            try {
                current.options["on" + type[0].toUpperCase() + type.slice(1)](
                    value,
                );
            } catch {}
    }
    function post(state, type, extra) {
        if (state.frame && state.frame.contentWindow)
            state.frame.contentWindow.postMessage(
                Object.assign(
                    { type: type, key: state.options.channelKey },
                    extra || {},
                ),
                state.frameOrigin,
            );
    }
    function configure(state) {
        state.configurationId++;
        post(state, "sendb:configure", {
            configurationId: state.configurationId,
            identityToken: state.identityToken || undefined,
            visitorToken: state.identityToken
                ? undefined
                : store(state.storageKey) || undefined,
            opened: state.opened,
            readId: state.readId,
            continueAnonymous: !!state.continueAnonymous,
            journeyToken: journeyContext(),
        });
        state.continueAnonymous = false;
    }
    function journeyContext() {
        try { return window.sendb && window.sendb.getJourneyContext ? window.sendb.getJourneyContext() : undefined; }
        catch { return undefined; }
    }
    window.addEventListener("sendb:journey-context", function () {
        if (current) post(current, "sendb:journey-context", { journeyToken: journeyContext() });
    });
    function waitForReady(state, message, code) {
        clearTimeout(state.timer);
        state.ready = false;
        state.waiting = true;
        state.awaitingReady = true;
        var promise = new Promise(function (resolve, reject) {
            state.resolve = resolve;
            state.reject = reject;
        });
        state.timer = setTimeout(function () {
            if (current !== state || !state.waiting) return;
            state.waiting = false;
            state.awaitingReady = false;
            var error = new Error(message);
            state.reject(error);
            emit("error", { code: code, message: error.message });
        }, 15000);
        return promise;
    }
    function reconnect() {
        var state = current;
        if (!state || !state.frame)
            return Promise.reject(
                new Error("상담 SDK 연결을 먼저 완료해주세요."),
            );
        if (state.waiting || state.identifying || state.refreshing)
            return Promise.reject(
                new Error("회원 상담을 연결하고 있습니다. 잠시 기다려주세요."),
            );
        var promise = waitForReady(
            state,
            "상담 인증을 확인하지 못했습니다. 다시 연결해주세요.",
            "reconnect_timeout",
        );
        configure(state);
        return promise;
    }
    function visibility(opened) {
        if (!current || !current.frame) return;
        current.opened = opened;
        current.frame.style.display = opened ? "block" : "none";
        current.button.textContent = opened ? "닫기" : "상담";
        current.button.setAttribute(
            "aria-label",
            opened ? "고객 상담 닫기" : "고객 상담 열기",
        );
        current.button.setAttribute("aria-expanded", String(opened));
        post(current, "sendb:visibility", { opened: opened });
        emit(opened ? "show" : "hide");
    }
    function shutdown() {
        sequence++;
        if (!current) return;
        var previous = current;
        current = null;
        window.removeEventListener("message", previous.listener);
        clearTimeout(previous.timer);
        clearTimeout(previous.refreshTimer);
        store(previous.storageKey, null);
        if (previous.frame) previous.frame.remove();
        if (previous.button) previous.button.remove();
        if (!previous.ready && previous.reject)
            previous.reject(new Error("상담 연결이 종료되었습니다."));
        emit("shutdown");
    }
    async function refresh(state) {
        if (
            state.refreshing ||
            state.identifying ||
            state.waiting ||
            current !== state
        )
            return;
        state.ready = false;
        if (!state.options.getIdentityToken) {
            emit("error", {
                code: "identity_refresh_required",
                message: "회원 상담 인증을 새로 받아주세요.",
            });
            return;
        }
        if (state.lastRefresh && Date.now() - state.lastRefresh < 30000) {
            emit("error", {
                code: "identity_refresh_failed",
                message:
                    "회원 인증을 갱신하지 못했습니다. 잠시 후 다시 연결해주세요.",
            });
            return;
        }
        state.lastRefresh = Date.now();
        state.refreshing = true;
        try {
            var value = await state.options.getIdentityToken();
            if (current !== state) return;
            state.identityToken =
                typeof value === "string" ? value : value.identityToken;
            if (!state.identityToken)
                throw new Error("회원 상담 인증을 받지 못했습니다.");
            waitForReady(
                state,
                "회원 상담 인증을 확인하지 못했습니다. 다시 연결해주세요.",
                "identity_refresh_failed",
            ).catch(function () {});
            configure(state);
            scheduleRefresh(state);
        } catch (error) {
            if (current === state)
                emit("error", {
                    code: "identity_refresh_failed",
                    message: error.message,
                });
        } finally {
            state.refreshing = false;
        }
    }
    function scheduleRefresh(state) {
        clearTimeout(state.refreshTimer);
        if (!state.identityToken || !state.options.getIdentityToken) return;
        var delay = 12 * 60000;
        try {
            var payload = JSON.parse(
                atob(
                    state.identityToken
                        .split(".")[1]
                        .replace(/-/g, "+")
                        .replace(/_/g, "/"),
                ),
            );
            delay = Math.max(
                30000,
                Math.min(delay, payload.exp * 1000 - Date.now() - 60000),
            );
        } catch {}
        state.refreshTimer = setTimeout(function () {
            refresh(state);
        }, delay);
    }
    async function boot(options) {
        var base = new URL(
            options.apiBase ||
                (script && script.src
                    ? new URL(script.src).origin
                    : location.origin),
        );
        if (
            base.username ||
            base.password ||
            !(
                base.protocol === "https:" ||
                (base.protocol === "http:" &&
                    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
            ) ||
            !/^[a-f0-9]{48}$/.test(options.channelKey || "")
        )
            throw new Error("상담 SDK 주소와 채널 키를 확인해주세요.");
        var retained =
            current &&
            current.options.channelKey === options.channelKey &&
            !current.identityToken &&
            !options.identityToken &&
            !options.getIdentityToken
                ? store(current.storageKey)
                : null;
        var messenger;
        if (options.messengerPath) {
            if (typeof options.messengerPath !== "string" || !/^\/(?!\/)[A-Za-z0-9/_.-]+\.html$/.test(options.messengerPath) || options.messengerPath.split("/").includes(".."))
                throw new Error("상담 화면 경로를 확인해주세요.");
            messenger = new URL(options.messengerPath, location.origin);
            if (messenger.origin !== location.origin)
                throw new Error("상담 화면은 이 사이트 안에 설치해주세요.");
        }
        shutdown();
        if (retained)
            store("sendb-chat-session:" + options.channelKey, retained);
        var state = {
            options: options,
            base: base.origin,
            frameOrigin: messenger ? messenger.origin : base.origin,
            opened: false,
            identityToken: options.identityToken || "",
            ready: false,
            hasConnected: false,
            waiting: false,
            awaitingReady: false,
            configurationId: 0,
            refreshing: false,
            readId: 0,
            storageKey: "sendb-chat-session:" + options.channelKey,
            generation: sequence,
        };
        current = state;
        if (options.getIdentityToken && !state.identityToken) {
            try {
                var identity = await options.getIdentityToken();
                if (current !== state) return;
                state.identityToken =
                    typeof identity === "string"
                        ? identity
                        : identity.identityToken;
            } catch (error) {
                if (current === state) {
                    current = null;
                    emit("error", {
                        code: "identity_failed",
                        message: error.message,
                    });
                }
                throw error;
            }
        }
        if (current !== state) return;
        var messengerHtml;
        if (messenger) {
            try {
                var htmlResponse = await fetch(messenger.href, {
                    credentials: "omit",
                    redirect: "error",
                    cache: "no-store",
                    signal: AbortSignal.timeout(10000),
                });
                if (!htmlResponse.ok || !(htmlResponse.headers.get("content-type") || "").startsWith("text/html"))
                    throw new Error("상담 화면을 불러오지 못했습니다.");
                var html = await htmlResponse.text();
                if (current !== state) return;
                if (html.length > 1000000) throw new Error("상담 화면 설정을 확인해주세요.");
                var parsed = new DOMParser().parseFromString(html, "text/html");
                if (!parsed.getElementById("sendb-messenger-root"))
                    throw new Error("상담 화면 설정을 확인해주세요.");
                parsed.documentElement.dataset.sendbParentOrigin = location.origin;
                parsed.documentElement.dataset.sendbApiBase = state.base;
                parsed.documentElement.dataset.sendbChannel = options.channelKey;
                parsed.documentElement.dataset.sendbPage = location.origin + location.pathname;
                Array.from(parsed.querySelectorAll("base")).forEach(function (node) { node.remove(); });
                var assetBase = parsed.createElement("base");
                assetBase.href = location.origin + "/";
                parsed.head.prepend(assetBase);
                messengerHtml = "<!doctype html>" + parsed.documentElement.outerHTML;
            } catch (error) {
                if (current === state) {
                    current = null;
                    emit("error", { code: "messenger_load_failed", message: "상담 화면을 불러오지 못했습니다. 다시 연결해주세요." });
                }
                throw error;
            }
        }
        if (current !== state) return;
        state.button = document.createElement("button");
        state.button.id = "sendb-chat-launcher";
        state.button.textContent = "상담";
        state.button.setAttribute("aria-label", "고객 상담 열기");
        state.button.setAttribute("aria-expanded", "false");
        state.button.style.cssText =
            "position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:22px;padding:18px 22px;background:#635BFF;color:white;font:600 15px system-ui;box-shadow:0 6px 24px #0002;cursor:pointer";
        state.button.hidden = !!options.hideLauncher;
        if (options.hideLauncher) state.button.style.display = "none";
        state.frame = document.createElement("iframe");
        state.frame.title = "Sendb 고객 상담";
        state.frame.style.cssText =
            "position:fixed;right:20px;bottom:96px;width:min(390px,calc(100vw - 32px));height:min(680px,calc(100dvh - 120px));border:1px solid #e5e7eb;border-radius:24px;box-shadow:0 16px 64px #0003;z-index:2147482999;background:white;display:none";
        state.frame.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms allow-downloads",
        );
        state.frame.setAttribute("referrerpolicy", "no-referrer");
        if (messengerHtml) state.frame.srcdoc = messengerHtml;
        else state.frame.src =
            (messenger ? messenger.href : state.base + "/chat/" + options.channelKey) +
            "?origin=" +
            encodeURIComponent(location.origin) +
            "&page=" +
            encodeURIComponent(location.origin + location.pathname) +
            (messenger ? "&channel=" + options.channelKey : "");
        state.button.addEventListener("click", function () {
            if (current === state) visibility(!state.opened);
        });
        var promise = waitForReady(
            state,
            "상담창을 연결하지 못했습니다. 설치 도메인과 서버 상태를 확인해주세요.",
            "boot_timeout",
        );
        state.listener = function (event) {
            if (
                current !== state ||
                event.origin !== state.frameOrigin ||
                event.source !== state.frame.contentWindow ||
                !event.data ||
                event.data.key !== options.channelKey
            )
                return;
            var data = event.data;
            if (
                data.configurationId !== undefined &&
                data.configurationId !== state.configurationId &&
                data.type !== "sendb:loaded"
            )
                return;
            if (data.type === "sendb:loaded") {
                if (state.waiting) configure(state);
                else if (
                    !state.identifying &&
                    !state.refreshing
                )
                    reconnect().catch(function () {});
            }
            if (
                data.type === "sendb:ready" &&
                state.awaitingReady &&
                state.configurationId > 0 &&
                data.configurationId === state.configurationId
            ) {
                state.ready = true;
                state.hasConnected = true;
                state.waiting = false;
                state.awaitingReady = false;
                clearTimeout(state.timer);
                state.resolve();
                scheduleRefresh(state);
                emit("ready");
            }
            if (
                data.type === "sendb:session" &&
                !state.identityToken &&
                /^[a-f0-9]{64}$/.test(data.token || "")
            )
                store(state.storageKey, data.token);
            if (data.type === "sendb:read")
                state.readId = Number(data.readId) || 0;
            if (data.type === "sendb:unread")
                emit("unreadCountChange", Math.max(0, Number(data.count) || 0));
            if (data.type === "sendb:refresh") refresh(state);
            if (data.type === "sendb:error") {
                if (state.identifying) return;
                if (data.status === 401 && state.identityToken) refresh(state);
                else if (data.status === 401) {
                    store(state.storageKey, null);
                    state.readId = 0;
                    if (state.waiting) configure(state);
                    else reconnect().catch(function () {});
                } else
                    emit("error", {
                        code: "messenger_error",
                        message: data.message,
                    });
            }
        };
        window.addEventListener("message", state.listener);
        document.body.appendChild(state.frame);
        document.body.appendChild(state.button);
        return promise;
    }
    async function trackEvent(name, properties, eventId) {
        var state = current;
        if (!state || !state.ready || !state.identityToken)
            throw new Error("회원 상담 연결 후 이벤트를 기록해주세요.");
        var response = await fetch(
            state.base + "/api/messenger/" + state.options.channelKey,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + state.identityToken,
                },
                body: JSON.stringify({
                    action: "track",
                    name: name,
                    properties: properties || {},
                    eventId: eventId || crypto.randomUUID(),
                }),
            },
        );
        var result = await response.json();
        if (!response.ok || !result.success)
            throw new Error(result.error || "이벤트를 기록하지 못했습니다.");
        return result.data;
    }
    function navigate(view, conversationId) {
        var state = current;
        if (
            !state ||
            !state.ready ||
            state.identifying ||
            state.refreshing
        )
            throw new Error("회원 상담 연결을 완료한 뒤 문의 화면을 열어주세요.");
        if (typeof state.identityToken !== "string" || !state.identityToken)
            throw new Error("문의 목록과 새 문의는 로그인한 회원만 사용할 수 있습니다.");
        if (
            view === "thread" &&
            (typeof conversationId !== "string" ||
                !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(
                    conversationId,
                ))
        )
            throw new Error("올바른 문의 ID를 입력해주세요.");
        post(
            state,
            "sendb:navigate",
            view === "thread"
                ? {
                      view: view,
                      conversationId: conversationId,
                      configurationId: state.configurationId,
                  }
                : { view: view, configurationId: state.configurationId },
        );
        visibility(true);
    }
    window.SendbChat = {
        version: "1.6.0",
        supportsFirstPartyMessenger: true,
        boot: boot,
        reconnect: reconnect,
        show: function () {
            visibility(true);
        },
        hide: function () {
            visibility(false);
        },
        showConversations: function () {
            navigate("list");
        },
        showNewConversation: function () {
            navigate("new");
        },
        showConversation: function (conversationId) {
            navigate("thread", conversationId);
        },
        showLauncher: function () {
            if (current && current.button) {
                current.button.hidden = false;
                current.button.style.display = "";
            }
        },
        hideLauncher: function () {
            if (current && current.button) {
                current.button.hidden = true;
                current.button.style.display = "none";
            }
        },
        getSessionType: function () {
            return current
                ? current.identityToken
                    ? "member"
                    : "anonymous"
                : "uninitialized";
        },
        setDraft: function (message) {
            if (!current || !current.ready)
                throw new Error("상담 연결 후 문구를 준비해주세요.");
            if (typeof message !== "string" || message.length > 5000)
                throw new Error("문구는 5,000자까지 입력할 수 있습니다.");
            post(current, "sendb:draft", { message: message });
        },
        updateVisitorProfile: async function (profile) {
            var state = current;
            if (!state || !state.ready || state.identityToken)
                throw new Error("비회원 상담 연결 후 정보를 입력해주세요.");
            if (
                !profile ||
                typeof profile.name !== "string" ||
                !profile.name.trim() ||
                profile.name.trim().length > 100 ||
                (profile.email !== undefined &&
                    (typeof profile.email !== "string" ||
                        profile.email.length > 254 ||
                        (profile.email &&
                            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))))
            )
                throw new Error("이름과 이메일을 확인해주세요.");
            var value = { name: profile.name.trim(), email: profile.email },
                token = store(state.storageKey);
            if (token) {
                var response = await fetch(
                    state.base + "/api/messenger/" + state.options.channelKey,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: "Bearer " + token,
                        },
                        body: JSON.stringify(
                            Object.assign({ action: "profile" }, value),
                        ),
                        credentials: "omit",
                        cache: "no-store",
                        redirect: "error",
                        signal: AbortSignal.timeout(10000),
                    },
                );
                var result = await response.json();
                if (
                    current !== state ||
                    state.identityToken ||
                    store(state.storageKey) !== token
                )
                    throw new Error("상담 연결이 변경되었습니다.");
                if (!response.ok || result.success !== true)
                    throw new Error(
                        result.error || "상담 입력 정보를 저장하지 못했습니다.",
                    );
            }
            post(state, "sendb:visitor-profile", value);
        },
        shutdown: shutdown,
        identify: async function (identityToken, options) {
            if (!current || !current.hasConnected)
                throw new Error("상담 SDK 연결을 먼저 완료해주세요.");
            if (typeof identityToken !== "string" || !identityToken)
                throw new Error("회원 상담 인증이 필요합니다.");
            var state = current;
            options = options || {};
            if (state.identifying || state.waiting || state.refreshing)
                throw new Error(
                    "회원 상담을 연결하고 있습니다. 잠시 기다려주세요.",
                );
            if (options.mergeAnonymous && state.identityToken)
                throw new Error(
                    "비회원 상담에서 로그인할 때만 이력을 연결할 수 있습니다.",
                );
            if (options.mergeAnonymous) {
                var anonymousToken = store(state.storageKey);
                if (anonymousToken) {
                    state.identifying = true;
                    post(state, "sendb:linking", { linking: true });
                    try {
                        var response = await fetch(
                            state.base +
                                "/api/messenger/" +
                                state.options.channelKey,
                            {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: "Bearer " + identityToken,
                                },
                                body: JSON.stringify({
                                    action: "identify",
                                    anonymousToken: anonymousToken,
                                }),
                            },
                        );
                        var result = await response.json();
                        if (!response.ok || !result.success)
                            throw new Error(
                                result.error ||
                                    "비회원 상담을 연결하지 못했습니다.",
                            );
                        if (current !== state)
                            throw new Error("상담 연결이 변경되었습니다.");
                    } finally {
                        state.identifying = false;
                        post(state, "sendb:linking", { linking: false });
                    }
                }
            }
            if (current !== state)
                throw new Error("상담 연결이 변경되었습니다.");
            store(state.storageKey, null);
            state.continueAnonymous = !!options.mergeAnonymous;
            if (typeof options.getIdentityToken === "function")
                state.options.getIdentityToken = options.getIdentityToken;
            state.identityToken = identityToken;
            state.readId = 0;
            var promise = waitForReady(
                state,
                "회원 상담 인증을 확인하지 못했습니다.",
                "identity_timeout",
            );
            configure(state);
            scheduleRefresh(state);
            return promise;
        },
        trackEvent: trackEvent,
        on: function (type, fn) {
            if (!listeners[type]) listeners[type] = [];
            listeners[type].push(fn);
            return function () {
                listeners[type] = (listeners[type] || []).filter(
                    function (item) {
                        return item !== fn;
                    },
                );
            };
        },
    };
    if (script && script.dataset.channel) {
        var start = function () {
            boot({
                apiBase: new URL(script.src).origin,
                channelKey: script.dataset.channel,
            }).catch(function () {});
        };
        if (document.readyState === "loading")
            document.addEventListener("DOMContentLoaded", start, {
                once: true,
            });
        else start();
    }
})();
