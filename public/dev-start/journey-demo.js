(function () {
    "use strict";
    var storage = "sendb-journey-demo-v1", setup = null, connected = false;
    var status = document.getElementById("status");
    function script(src, attrs) {
        return new Promise(function (resolve, reject) {
            var el = document.createElement("script"); el.src = src;
            Object.keys(attrs || {}).forEach(function (name) { el.setAttribute(name, attrs[name]); });
            el.onload = resolve; el.onerror = reject; document.head.appendChild(el);
        });
    }
    async function prepare(mode) {
        var response = await fetch("/api/inbox-journey/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: mode }), cache: "no-store" });
        var result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error || "자료를 준비하지 못했습니다.");
        return result.data;
    }
    async function boot(value) {
        setup = value;
        // 저장하는 값은 가상 리드 번호·공개 채널/트래커 키뿐이며 회원 JWT는 저장하지 않는다.
        try { sessionStorage.setItem(storage, JSON.stringify(value)); } catch (e) {}
        var url = new URL(location.href); url.searchParams.set("sendb_cid", setup.clickId); history.replaceState({}, "", url);
        ["service", "pricing"].forEach(function (step) { var next = new URL(url); next.searchParams.set("step", step); document.getElementById(step).href = next.pathname + next.search; });
        var staff = document.getElementById("staff"); staff.href = "/inbox?channelId=" + setup.channelId; staff.target = "_blank"; staff.hidden = false;
        status.textContent = "가상 리드 #" + setup.recordId + " 준비 완료 · 실제 외부 발송 없음";
        if (connected) return;
        await script("/tracker.js", { "data-api-key": setup.trackerKey, "data-endpoint": location.origin + "/api/tracker/collect" });
        await script("/sendb-sdk.js");
        await window.SendbChat.boot({ apiBase: location.origin, channelKey: setup.channelKey });
        connected = true; document.getElementById("member").disabled = false;
    }
    var pricing = new URLSearchParams(location.search).get("step") === "pricing";
    if (pricing) { document.title = "가상 가격·도입 안내"; document.getElementById("page-title").textContent = "2. 가격·도입 안내 페이지"; document.getElementById("page-copy").textContent = "필요한 디자인 업무와 기간을 확인한 뒤 상담으로 도입 범위를 정한다는 가상 안내입니다. 실제 가격이나 계약 조건이 아닙니다."; }
    document.getElementById("prepare").onclick = async function () {
        this.disabled = true; status.textContent = "가상 자료를 준비하고 있습니다…";
        try { await boot(await prepare("anonymous")); } catch (e) { status.textContent = e.message; }
        this.disabled = false;
    };
    document.getElementById("member").onclick = async function () {
        this.disabled = true; var message = document.getElementById("member-status");
        try { var result = await prepare("member"); await window.SendbChat.identify(result.identityToken, { mergeAnonymous: true }); message.textContent = "가상 회원으로 연결됐습니다. 직원 화면에서 확인된 고객 연결을 확인하세요."; }
        catch (e) { message.textContent = e.message; }
        this.disabled = false;
    };
    try { var saved = sessionStorage.getItem(storage); if (saved) boot(JSON.parse(saved)).catch(function (e) { status.textContent = e.message; }); } catch (e) {}
})();
