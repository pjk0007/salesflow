/* 기존 한 줄 설치 코드 호환 로더. API 연동은 sendb-sdk.js와 SendbChat.boot를 사용합니다. */
(function () {
    var current = document.currentScript;
    if (!current) return;
    var sdk = document.createElement("script");
    sdk.src = new URL("/sendb-sdk.js", current.src).href;
    if (current.dataset.channel) sdk.dataset.channel = current.dataset.channel;
    sdk.async = true;
    document.head.appendChild(sdk);
})();
