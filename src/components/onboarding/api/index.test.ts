// UX-001·004·006 — 온보딩 단계 요청: 워크스페이스 중복 생성 방지, 실패 전달, 초대 결과 분리(가짜 전송, 실제 요청 없음).
import { test } from "node:test";
import assert from "node:assert/strict";
import { RequestError } from "@/lib/swr-fetcher";
import {
    applyOnboardingTemplate,
    createOnboardingInvites,
    inviteEmailsToSend,
    saveOnboardingWorkspace,
    type OnboardingRequest,
} from "./index";

interface Sent { url: string; method?: string; body: unknown }

/** 요청을 기록하고 respond가 돌려준 값을 응답으로 준다(Error면 던진다). */
function fakeRequest(respond: (sent: Sent) => unknown) {
    const sent: Sent[] = [];
    const request: OnboardingRequest = async <T,>(url: string, options?: RequestInit) => {
        const call = { url, method: options?.method, body: options?.body ? JSON.parse(String(options.body)) : undefined };
        sent.push(call);
        const result = respond(call);
        if (result instanceof Error) throw result;
        return result as T;
    };
    return { request, sent };
}

test("워크스페이스: 처음엔 POST 1회, 뒤로 갔다 다시 '다음'은 같은 id에 PATCH — 생성은 한 번뿐 (UX-001)", async () => {
    const { request, sent } = fakeRequest(() => ({ success: true, data: { id: 7 } }));

    // 정방향 1회
    let id = await saveOnboardingWorkspace({ workspaceId: null, name: " 영업관리 ", icon: "" }, request);
    assert.equal(id, 7);
    // 3단계에서 '이전' → 이름 바꿔 '다음', 두 번 반복
    id = await saveOnboardingWorkspace({ workspaceId: id, name: "영업팀", icon: "🚀" }, request);
    id = await saveOnboardingWorkspace({ workspaceId: id, name: "영업팀 2", icon: "" }, request);

    assert.deepEqual(sent.map((s) => `${s.method} ${s.url}`), [
        "POST /api/workspaces",
        "PATCH /api/workspaces/7/settings",
        "PATCH /api/workspaces/7/settings",
    ]);
    assert.equal(sent.filter((s) => s.method === "POST").length, 1);
    assert.deepEqual(sent[0].body, { name: "영업관리" }); // 빈 아이콘은 보내지 않음(기존과 같음)
    assert.deepEqual(sent[1].body, { name: "영업팀", icon: "🚀" }); // 이름 변경 반영
    assert.deepEqual(sent[2].body, { name: "영업팀 2", icon: "" }); // 아이콘 지우기도 반영
});

test("워크스페이스 한도 초과 등 서버 거부는 던져서 단계가 넘어가지 않게 한다 (UX-001·004)", async () => {
    const limit = new RequestError("워크스페이스 한도(1개)를 초과했습니다. 플랜 업그레이드가 필요합니다.", 403, true);
    const { request } = fakeRequest(() => limit);
    await assert.rejects(saveOnboardingWorkspace({ workspaceId: null, name: "영업관리", icon: "" }, request), limit);
});

test("템플릿 적용: 성공 시 생성 수·건너뛴 항목, 실패는 던진다 (UX-004)", async () => {
    const ok = fakeRequest(() => ({ success: true, data: { created: 3, skippedItems: [{ key: "email", reason: "이미 있는 key" }] } }));
    const result = await applyOnboardingTemplate(7, [], ok.request);
    assert.deepEqual(result, { created: 3, skippedItems: [{ key: "email", reason: "이미 있는 key" }] });
    assert.equal(ok.sent[0].url, "/api/workspaces/7/fields/bulk");

    const old = fakeRequest(() => ({ success: true, data: { created: 2 } }));
    assert.deepEqual(await applyOnboardingTemplate(7, [], old.request), { created: 2, skippedItems: [] });

    const failed = fakeRequest(() => new RequestError("서버 오류가 발생했습니다.", 500, true));
    await assert.rejects(applyOnboardingTemplate(7, [], failed.request), RequestError);
});

test("초대 이메일 정리: 공백·대소문자·중복·형식 (UX-006)", () => {
    assert.deepEqual(inviteEmailsToSend([" A@x.test ", "a@x.test", "", "no-at", "b@x.test"]), ["a@x.test", "b@x.test"]);
});

test("초대: 메일 발송 여부·생성 실패를 나누고, 다시 시도하면 이미 만든 이메일은 건너뛴다 (UX-006)", async () => {
    const duplicate = new RequestError("이미 대기 중인 초대가 있습니다.", 409, true);
    let failC = true;
    const { request, sent } = fakeRequest((s) => {
        const email = (s.body as { email: string }).email;
        if (email === "a@x.test") return { success: true, data: { emailSent: true } };
        if (email === "b@x.test") return { success: true, data: { emailSent: false } }; // 메일 설정 없음
        if (email === "c@x.test" && failC) return duplicate;
        return { success: true, data: { emailSent: true } };
    });

    const first = await createOnboardingInvites(["a@x.test", "B@x.test", "c@x.test"], new Map(), request);
    assert.deepEqual([...first.created], [["a@x.test", true], ["b@x.test", false]]);
    assert.deepEqual(first.failures.map((f) => [f.email, f.error]), [["c@x.test", duplicate]]);
    assert.equal(sent.length, 3);

    // 5단계 → '이전' → 4단계 '완료' 다시: a·b는 다시 요청하지 않는다
    failC = false;
    const second = await createOnboardingInvites(["a@x.test", "b@x.test", "c@x.test"], first.created, request);
    assert.deepEqual(sent.slice(3).map((s) => (s.body as { email: string }).email), ["c@x.test"]);
    assert.equal(second.created.size, 3);
    assert.equal([...second.created.values()].filter((emailSent) => !emailSent).length, 1); // 미발송 1건 안내 대상
    assert.equal(second.failures.length, 0);
    assert.equal(first.created.size, 2); // 이전 결과는 바꾸지 않는다
});
