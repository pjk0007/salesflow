import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useAiEmail } from "./useAiEmail";

// 실제 React에서 훅을 생성하고 전송·취소의 ref 경계를 시험한다. DOM/effect 실측은 별도다.
function renderHook() {
    function Probe({ capture }: { capture: (hook: ReturnType<typeof useAiEmail>) => void }) {
        capture(useAiEmail());
        return null;
    }
    return new Promise<ReturnType<typeof useAiEmail>>(capture => {
        renderToStaticMarkup(createElement(Probe, { capture }));
    });
}
const input = { prompt: "가상 초안" };
const response = () => new Response(`event: chunk\ndata: ${JSON.stringify({ text: JSON.stringify({ subject: "가상", htmlBody: "본문" }) })}\n\nevent: done\ndata: {}\n\n`);

test("UX-168 같은 틱 중복 생성은 1회 요청이며 취소 후 이전 finally가 새 요청을 지우지 않는다", async (t) => {
    const requests: { finish: (r: Response) => void; signal: AbortSignal }[] = [];
    t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise<Response>(finish => requests.push({ finish, signal: init.signal! })));
    const hook = await renderHook();
    const seen: string[] = [];
    const first = hook.generateEmailStream(input, text => seen.push(text));
    assert.equal((await hook.generateEmailStream(input, () => {})).success, false);
    assert.equal(requests.length, 1);
    hook.cancelStream();
    assert.equal(requests[0].signal.aborted, true);
    const second = hook.generateEmailStream(input, text => seen.push(text));
    requests[0].finish(response());
    assert.match((await first).error!, /취소/);
    assert.equal((await hook.generateEmailStream(input, () => {})).success, false);
    assert.equal(requests.length, 2, "이전 finally 이후에도 두 번째 요청은 보호된다");
    hook.cancelStream();
    assert.equal(requests[1].signal.aborted, true);
    requests[1].finish(response());
    assert.match((await second).error!, /취소/);
    assert.equal(seen.length, 0, "취소 뒤 늦은 본문은 작성기에 적용되지 않는다");
});

test("가상 스트림 정상 완료 후 같은 훅에서 다시 생성할 수 있다", async (t) => {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls++; return response(); });
    const hook = await renderHook();
    assert.equal((await hook.generateEmailStream(input, () => {})).success, true);
    assert.equal((await hook.generateEmailStream(input, () => {})).success, true);
    assert.equal(calls, 2);
});
