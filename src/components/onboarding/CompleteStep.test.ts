// UX-006 — 온보딩 완료 화면이 초대 생성·메일 미발송·생성 실패를 나눠 보여주는지(정적 렌더).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CompleteStep from "./CompleteStep";

const render = (props: Partial<Parameters<typeof CompleteStep>[0]>) =>
    renderToStaticMarkup(createElement(CompleteStep, {
        workspaceName: "영업관리", fieldsCreated: 0, invitesSent: 0, onStart: () => {}, isLoading: false, ...props,
    }));

test("메일이 모두 나갔으면 생성 수만 보이고 경고는 없다", () => {
    const html = render({ invitesSent: 2 });
    assert.match(html, /2명 초대 생성/);
    assert.doesNotMatch(html, /메일을 보내지 못했습니다|만들지 못했습니다/);
});

test("메일 미발송 건수와 팀멤버 링크 복사 안내, 생성 실패 건수를 따로 보인다", () => {
    const html = render({ invitesSent: 2, invitesUnsent: 1, inviteFailures: 1 });
    assert.match(html, /1건은 메일을 보내지 못했습니다\. 설정 &gt; 팀멤버에서 초대 링크를 복사해 전달해주세요\./);
    assert.match(html, /role="alert"[^>]*>초대 1건을 만들지 못했습니다/);
});

test("모두 실패해 초대가 0건이어도 실패 안내는 남고 '건너뛰었습니다'로 바꾸지 않는다", () => {
    const html = render({ workspaceName: "", inviteFailures: 2 });
    assert.match(html, /초대 2건을 만들지 못했습니다/);
    assert.doesNotMatch(html, /설정을 건너뛰었습니다/);
});

test("아무것도 하지 않고 넘어온 경우에만 '건너뛰었습니다'", () => {
    assert.match(render({ workspaceName: "" }), /설정을 건너뛰었습니다/);
});
