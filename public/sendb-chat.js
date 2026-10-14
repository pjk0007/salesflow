/* Sendb 사이트 상담 위젯. 외부 SDK나 채널톡 계정 없이 동작합니다. */
(function () {
    "use strict";
    var script = document.currentScript;
    if (
        !script ||
        !/^[a-f0-9]{48}$/.test(script.dataset.channel || "") ||
        document.getElementById("sendb-chat-launcher")
    )
        return;
    var base = new URL(script.src).origin,
        key = script.dataset.channel;
    function mount() {
        var button = document.createElement("button"),
            frame = document.createElement("iframe"),
            open = false;
        button.id = "sendb-chat-launcher";
        button.setAttribute("aria-label", "고객 상담 열기");
        button.setAttribute("aria-expanded", "false");
        button.textContent = "상담";
        button.style.cssText =
            "position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:22px;padding:18px 22px;background:#635BFF;color:white;font:600 15px system-ui;box-shadow:0 6px 24px #0002;cursor:pointer";
        frame.title = "Sendb 고객 상담";
        frame.style.cssText =
            "position:fixed;right:20px;bottom:96px;width:min(390px,calc(100vw - 32px));height:min(680px,calc(100dvh - 120px));border:1px solid #e5e7eb;border-radius:24px;box-shadow:0 16px 64px #0003;z-index:2147482999;background:white;display:none";
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.setAttribute(
            "sandbox",
            "allow-scripts allow-same-origin allow-forms",
        );
        button.addEventListener("click", function () {
            open = !open;
            if (!frame.src)
                frame.src =
                    base +
                    "/chat/" +
                    key +
                    "?origin=" +
                    encodeURIComponent(location.origin) +
                    "&page=" +
                    encodeURIComponent(location.origin + location.pathname);
            frame.style.display = open ? "block" : "none";
            button.textContent = open ? "닫기" : "상담";
            button.setAttribute(
                "aria-label",
                open ? "고객 상담 닫기" : "고객 상담 열기",
            );
            button.setAttribute("aria-expanded", String(open));
        });
        document.body.appendChild(frame);
        document.body.appendChild(button);
    }
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", mount, { once: true });
    else mount();
})();
