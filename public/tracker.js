(function () {
    "use strict";

    // 자기 자신(<script> 태그)을 즉시 캡처. defer 환경에서도 동작.
    // 다른 트래커(GA, adion 등)가 같은 페이지에 있어도 자기 태그만 정확히 찾기 위함.
    var SELF_SCRIPT = document.currentScript;

    var STORAGE_VISITOR = "sendb_vid";
    var STORAGE_SESSION = "sendb_sid";
    var STORAGE_SESSION_TS = "sendb_sts";
    var STORAGE_CLICK_ID = "sendb_cid";
    var STORAGE_CLICK_ID_TS = "sendb_cid_ts";

    var SESSION_TIMEOUT = 30 * 60 * 1000;       // 30분
    var CLICK_ID_TTL = 30 * 24 * 60 * 60 * 1000; // 30일
    var HEARTBEAT_INTERVAL = 30000;

    var config = { apiKey: "", endpoint: "" };
    var heartbeatTimer = null;

    // ── Utilities ──

    function uuid() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    // ── Visitor ID (localStorage) ──

    function getVisitorId() {
        try {
            var id = localStorage.getItem(STORAGE_VISITOR);
            if (!id) {
                id = uuid();
                localStorage.setItem(STORAGE_VISITOR, id);
            }
            return id;
        } catch (e) {
            // private browsing fallback
            return uuid();
        }
    }

    // 크로스도메인 인계: URL에 sendb_vid 있으면 그 visitor_id를 채택.
    // 다른 등록 도메인에서 넘어온 동일 방문자를 익명 단계에서도 이어줌.
    function adoptVisitorIdFromUrl() {
        try {
            var sp = new URLSearchParams(location.search);
            var fromUrl = sp.get("sendb_vid");
            if (fromUrl) {
                localStorage.setItem(STORAGE_VISITOR, fromUrl);
            }
        } catch (e) {}
    }

    // ── Session Management ──

    function getSessionKey() {
        try {
            var key = sessionStorage.getItem(STORAGE_SESSION);
            var ts = sessionStorage.getItem(STORAGE_SESSION_TS);
            var now = Date.now();
            if (key && ts && now - parseInt(ts, 10) < SESSION_TIMEOUT) {
                sessionStorage.setItem(STORAGE_SESSION_TS, String(now));
                return key;
            }
            key = uuid();
            sessionStorage.setItem(STORAGE_SESSION, key);
            sessionStorage.setItem(STORAGE_SESSION_TS, String(now));
            return key;
        } catch (e) {
            return uuid();
        }
    }

    // ── Click ID (sendb_cid) ──

    function getClickId() {
        try {
            var sp = new URLSearchParams(location.search);
            var fromUrl = sp.get("sendb_cid");
            if (fromUrl) {
                localStorage.setItem(STORAGE_CLICK_ID, fromUrl);
                localStorage.setItem(STORAGE_CLICK_ID_TS, String(Date.now()));
                return fromUrl;
            }
            var stored = localStorage.getItem(STORAGE_CLICK_ID);
            var ts = parseInt(localStorage.getItem(STORAGE_CLICK_ID_TS) || "0", 10);
            if (stored && Date.now() - ts < CLICK_ID_TTL) {
                return stored;
            }
        } catch (e) {}
        return null;
    }

    // ── UTM Parsing ──

    function parseUtm() {
        var sp = new URLSearchParams(location.search);
        var result = {};
        if (sp.get("utm_source")) result.utm_source = sp.get("utm_source");
        if (sp.get("utm_medium")) result.utm_medium = sp.get("utm_medium");
        if (sp.get("utm_campaign")) result.utm_campaign = sp.get("utm_campaign");
        if (sp.get("utm_term")) result.utm_term = sp.get("utm_term");
        if (sp.get("utm_content")) result.utm_content = sp.get("utm_content");
        return result;
    }

    // ── Traffic Source Classification ──

    var SEARCH_ENGINES = ["google", "bing", "yahoo", "duckduckgo", "naver", "daum", "baidu"];
    var SOCIAL_PLATFORMS = ["facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok", "t.co", "kakao"];

    function classifyTrafficSource(referrer, utm) {
        if (utm.utm_medium) {
            var medium = utm.utm_medium.toLowerCase();
            if (medium === "cpc" || medium === "ppc" || medium === "paid" || medium === "cpm") return "PAID";
            if (medium === "social") return "SOCIAL";
            if (medium === "email") return "EMAIL";
            if (medium === "organic") return "ORGANIC";
            if (medium === "referral") return "REFERRAL";
        }
        if (utm.utm_source) return "PAID";
        if (!referrer) return "DIRECT";
        try {
            var domain = new URL(referrer).hostname.toLowerCase();
            if (domain === location.hostname) return "DIRECT";
            for (var i = 0; i < SEARCH_ENGINES.length; i++) {
                if (domain.indexOf(SEARCH_ENGINES[i]) !== -1) return "ORGANIC";
            }
            for (var j = 0; j < SOCIAL_PLATFORMS.length; j++) {
                if (domain.indexOf(SOCIAL_PLATFORMS[j]) !== -1) return "SOCIAL";
            }
            return "REFERRAL";
        } catch (e) {
            return "DIRECT";
        }
    }

    // ── Device Detection ──

    function detectDevice() {
        var ua = navigator.userAgent || "";
        var isMobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        var isTablet = /iPad|Android(?!.*Mobile)/i.test(ua);

        var browser = "unknown";
        if (ua.indexOf("Firefox") > -1) browser = "Firefox";
        else if (ua.indexOf("Edg") > -1) browser = "Edge";
        else if (ua.indexOf("Chrome") > -1) browser = "Chrome";
        else if (ua.indexOf("Safari") > -1) browser = "Safari";
        else if (ua.indexOf("Opera") > -1 || ua.indexOf("OPR") > -1) browser = "Opera";

        var os = "unknown";
        if (ua.indexOf("Win") > -1) os = "Windows";
        else if (ua.indexOf("Mac") > -1) os = "macOS";
        else if (ua.indexOf("Linux") > -1) os = "Linux";
        else if (ua.indexOf("Android") > -1) os = "Android";
        else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";

        return {
            type: isTablet ? "tablet" : isMobile ? "mobile" : "desktop",
            browser: browser,
            os: os,
        };
    }

    // ── Send Event ──

    var sessionInfoSent = false;

    function buildSessionData() {
        if (sessionInfoSent) return undefined;
        sessionInfoSent = true;
        var utm = parseUtm();
        var referrer = document.referrer || "";
        return {
            landing_page: location.href,
            referrer: referrer || undefined,
            traffic_source: classifyTrafficSource(referrer, utm),
            utm_source: utm.utm_source,
            utm_medium: utm.utm_medium,
            utm_campaign: utm.utm_campaign,
            utm_term: utm.utm_term,
            utm_content: utm.utm_content,
        };
    }

    function sendCollect(eventData) {
        if (!config.apiKey || !config.endpoint) return;

        var payload = JSON.stringify({
            visitor_id: getVisitorId(),
            session_key: getSessionKey(),
            click_id: config.clickId || undefined,
            event: eventData,
            session: buildSessionData(),
            device: detectDevice(),
        });

        var url = config.endpoint + "?key=" + encodeURIComponent(config.apiKey);
        // fetch with keepalive — CORS 명확 + 페이지 unload 시 손실 방지
        try {
            if (typeof fetch !== "undefined") {
                fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: payload,
                    keepalive: true,
                    mode: "cors",
                    credentials: "omit",
                })
                    .then(function (res) {
                        return res.json();
                    })
                    .then(function (json) {
                        // 등록 도메인 목록 수신 → 크로스도메인 링킹에 사용
                        if (json && json.domains && !config.domains) {
                            config.domains = json.domains;
                        }
                    })
                    .catch(function () {});
                return;
            }
        } catch (e) {}

        // fallback: XHR
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", url, true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(payload);
        } catch (e) {}
    }

    function sendIdentify(props) {
        if (!config.apiKey || !config.identifyEndpoint) return;
        var payload = JSON.stringify({
            visitor_id: getVisitorId(),
            email: props.email,
            user_id: props.user_id,
            name: props.name,
            phone: props.phone,
        });
        try {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", config.identifyEndpoint + "?key=" + encodeURIComponent(config.apiKey), true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.send(payload);
        } catch (e) {}
    }

    // ── Page View ──

    function trackPageView() {
        sendCollect({
            type: "PAGE_VIEW",
            page_url: location.href,
            page_title: document.title,
        });
    }

    // ── Heartbeat ──

    function startHeartbeat() {
        if (heartbeatTimer) return;
        heartbeatTimer = setInterval(function () {
            sendCollect({ type: "HEARTBEAT" });
        }, HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function setupHeartbeat() {
        startHeartbeat();
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) {
                stopHeartbeat();
                sendCollect({ type: "SESSION_END" });
            } else {
                startHeartbeat();
            }
        });
    }

    // ── SPA Navigation ──

    function setupSpaTracking() {
        var originalPushState = history.pushState;
        var originalReplaceState = history.replaceState;
        history.pushState = function () {
            originalPushState.apply(this, arguments);
            onUrlChange();
        };
        history.replaceState = function () {
            originalReplaceState.apply(this, arguments);
            onUrlChange();
        };
        window.addEventListener("popstate", onUrlChange);

        var lastUrl = location.href;
        function onUrlChange() {
            var currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                setTimeout(trackPageView, 100);
            }
        }
    }

    // ── Cross-domain Linking ──
    // 등록된 다른 도메인으로 가는 링크에 sendb_cid 자동 부착.
    // 이메일로 식별된 방문자가 다른 사이트(데모 등)로 이동해도 동일인으로 추적.

    function isTrackedDomain(hostname) {
        if (!config.domains || !config.domains.length) return false;
        var host = hostname.toLowerCase();
        for (var i = 0; i < config.domains.length; i++) {
            var d = String(config.domains[i]).toLowerCase();
            if (host === d || host === "www." + d || "www." + host === d) {
                return true;
            }
        }
        return false;
    }

    function decorateLink(href) {
        try {
            var url = new URL(href, location.href);
            // 같은 도메인이면 localStorage 공유되므로 부착 불필요
            if (url.hostname === location.hostname) return null;
            // 등록 안 된 도메인이면 무시
            if (!isTrackedDomain(url.hostname)) return null;
            // 이미 인계 파라미터가 있으면 건드리지 않음
            if (url.searchParams.has("sendb_vid")) return null;

            // visitor_id 전파 — 익명 포함 동일인 인계
            url.searchParams.set("sendb_vid", getVisitorId());
            // 이메일 클릭 ID도 있으면 같이 전파 (식별 정보 유지)
            if (config.clickId) {
                url.searchParams.set("sendb_cid", config.clickId);
            }
            return url.toString();
        } catch (e) {
            return null;
        }
    }

    function setupCrossDomainLinking() {
        document.addEventListener(
            "click",
            function (e) {
                // 이미 다른 핸들러가 막았거나 보조키 클릭이면 무시
                if (e.defaultPrevented) return;
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                if (e.button !== 0) return;

                var el = e.target;
                while (el && el.tagName !== "A") {
                    el = el.parentElement;
                }
                if (!el) return;

                var rawHref = el.getAttribute("href") || el.href;
                if (!rawHref) return;

                var decorated = decorateLink(rawHref);
                if (!decorated) return;

                // 우리가 직접 네비게이션 — el.href만 바꾸면
                // Next.js <Link> 등이 원래 href로 가버리므로 클릭 자체를 가로챔
                e.preventDefault();
                e.stopPropagation();

                var target = el.getAttribute("target");
                if (target === "_blank") {
                    window.open(decorated, "_blank", "noopener");
                } else {
                    window.location.href = decorated;
                }
            },
            true, // capture 단계 — Next.js Link 핸들러보다 먼저 잡음
        );
    }

    // ── Public API ──

    window.sendb = {
        track: function (eventName, properties) {
            sendCollect({
                type: "CUSTOM",
                name: eventName,
                page_url: location.href,
                page_title: document.title,
                properties: properties || null,
            });
        },
        trackPurchase: function (revenue, properties) {
            sendCollect({
                type: "PURCHASE",
                name: "purchase",
                revenue: revenue,
                page_url: location.href,
                page_title: document.title,
                properties: properties || null,
            });
        },
        identify: function (options) {
            var props = {};
            if (typeof options === "string") {
                props.email = options;
                if (arguments.length > 1) props.name = arguments[1];
            } else if (options && typeof options === "object") {
                if (options.email) props.email = options.email;
                if (options.userId) props.user_id = options.userId;
                if (options.name) props.name = options.name;
                if (options.phone) props.phone = options.phone;
            }
            sendIdentify(props);
        },
        getVisitorId: function () {
            return getVisitorId();
        },
        getClickId: function () {
            return config.clickId || null;
        },
    };

    // ── Init ──

    function findSelfScript() {
        // 1순위: 캡처해둔 currentScript
        if (SELF_SCRIPT && SELF_SCRIPT.getAttribute("data-endpoint")) {
            return SELF_SCRIPT;
        }
        // 2순위: src에 sendb tracker.js를 포함하고 data-endpoint를 가진 script
        var scripts = document.getElementsByTagName("script");
        for (var i = 0; i < scripts.length; i++) {
            var s = scripts[i];
            var src = s.getAttribute("src") || "";
            if (src.indexOf("/tracker.js") !== -1 && s.getAttribute("data-endpoint")) {
                return s;
            }
        }
        return null;
    }

    function init() {
        var self = findSelfScript();
        if (self) {
            config.apiKey = self.getAttribute("data-api-key") || "";
            config.endpoint = self.getAttribute("data-endpoint") || "";
            config.identifyEndpoint = self.getAttribute("data-identify-endpoint") || "";
        }
        if (!config.apiKey || !config.endpoint) return;
        if (!config.identifyEndpoint) {
            // default: collect와 같은 base로 추정
            config.identifyEndpoint = config.endpoint.replace(/\/collect\/?$/, "/identify");
        }

        config.clickId = getClickId();

        // URL로 넘어온 visitor_id 우선 채택 (크로스도메인 인계)
        adoptVisitorIdFromUrl();

        getVisitorId();
        getSessionKey();
        trackPageView();
        setupSpaTracking();
        setupHeartbeat();
        setupCrossDomainLinking();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
