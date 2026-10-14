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
                state.base,
            );
    }
    function configure(state) {
        post(state, "sendb:configure", {
            identityToken: state.identityToken || undefined,
            visitorToken: state.identityToken
                ? undefined
                : store(state.storageKey) || undefined,
            opened: state.opened,
            readId: state.readId,
            continueAnonymous: !!state.continueAnonymous,
        });
        state.continueAnonymous = false;
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
        if (state.refreshing || current !== state) return;
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
            state.ready = false;
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
        shutdown();
        if (retained)
            store("sendb-chat-session:" + options.channelKey, retained);
        var state = {
            options: options,
            base: base.origin,
            opened: false,
            identityToken: options.identityToken || "",
            ready: false,
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
        state.button = document.createElement("button");
        state.button.id = "sendb-chat-launcher";
        state.button.textContent = "상담";
        state.button.setAttribute("aria-label", "고객 상담 열기");
        state.button.setAttribute("aria-expanded", "false");
        state.button.style.cssText =
            "position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:22px;padding:18px 22px;background:#635BFF;color:white;font:600 15px system-ui;box-shadow:0 6px 24px #0002;cursor:pointer";
        state.frame = document.createElement("iframe");
        state.frame.title = "Sendb 고객 상담";
        state.frame.style.cssText =
            "position:fixed;right:20px;bottom:96px;width:min(390px,calc(100vw - 32px));height:min(680px,calc(100dvh - 120px));border:1px solid #e5e7eb;border-radius:24px;box-shadow:0 16px 64px #0003;z-index:2147482999;background:white;display:none";
        state.frame.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms",
        );
        state.frame.setAttribute("referrerpolicy", "no-referrer");
        state.frame.src =
            state.base +
            "/chat/" +
            options.channelKey +
            "?origin=" +
            encodeURIComponent(location.origin) +
            "&page=" +
            encodeURIComponent(location.origin + location.pathname);
        state.button.addEventListener("click", function () {
            if (current === state) visibility(!state.opened);
        });
        var promise = new Promise(function (resolve, reject) {
            state.resolve = resolve;
            state.reject = reject;
        });
        state.listener = function (event) {
            if (
                current !== state ||
                event.origin !== state.base ||
                event.source !== state.frame.contentWindow ||
                !event.data ||
                event.data.key !== options.channelKey
            )
                return;
            var data = event.data;
            if (data.type === "sendb:loaded") configure(state);
            if (data.type === "sendb:ready" && !state.ready) {
                state.ready = true;
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
                    configure(state);
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
        state.timer = setTimeout(function () {
            if (current === state && !state.ready) {
                var error = new Error(
                    "상담창을 연결하지 못했습니다. 설치 도메인과 서버 상태를 확인해주세요.",
                );
                state.reject(error);
                emit("error", { code: "boot_timeout", message: error.message });
            }
        }, 15000);
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
    window.SendbChat = {
        version: "1.1.0",
        boot: boot,
        show: function () {
            visibility(true);
        },
        hide: function () {
            visibility(false);
        },
        shutdown: shutdown,
        identify: async function (identityToken, options) {
            if (!current || !current.ready)
                throw new Error("상담 SDK 연결을 먼저 완료해주세요.");
            if (typeof identityToken !== "string" || !identityToken)
                throw new Error("회원 상담 인증이 필요합니다.");
            var state = current;
            options = options || {};
            if (state.identifying)
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
            state.ready = false;
            var promise = new Promise(function (resolve, reject) {
                state.resolve = resolve;
                state.reject = reject;
            });
            state.timer = setTimeout(function () {
                if (current === state && !state.ready) {
                    var error = new Error(
                        "회원 상담 인증을 확인하지 못했습니다.",
                    );
                    state.reject(error);
                    emit("error", {
                        code: "identity_timeout",
                        message: error.message,
                    });
                }
            }, 15000);
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
