import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TrackerSettingsPanel } from "./TrackerSettingsPanel";
import type { TrackerSite } from "../types";

const site: TrackerSite = {
    id: 3, orgId: "00000000-0000-4000-8000-000000000001", workspaceId: 9, name: "가상 사이트", apiKey: "fake-site-key",
    domains: ["shop.example.test"], isActive: 1, matchField: "email", excludePaths: ["/main/"], conversionStage: null,
    createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};

const render = (props: Partial<Parameters<typeof TrackerSettingsPanel>[0]> = {}) =>
    renderToStaticMarkup(createElement(TrackerSettingsPanel, { site, onUpdated: () => {}, ...props }));

const buttonTexts = (html: string) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

test("UX-276 관리자는 기존처럼 도메인 추가·저장·퍼널 추가·별칭 등록 버튼을 본다", () => {
    const html = render();
    const buttons = buttonTexts(html);
    assert.ok(buttons.some((b) => b.includes("추가")), "도메인·퍼널 추가");
    assert.ok(buttons.some((b) => b === "저장"), "매칭 필드·제외 경로 저장");
    assert.ok(buttons.some((b) => b.includes("별칭 등록")));
    assert.match(html, /placeholder="example.com"/);
    assert.doesNotMatch(html, /관리자만 바꿀 수 있습니다/);
});

test("UX-276 일반 멤버(readOnly)는 편집 버튼 없이 안내와 현재 값·스크립트만 본다", () => {
    const html = render({ readOnly: true });
    const buttons = buttonTexts(html);
    assert.ok(!buttons.some((b) => b.includes("추가") || b === "저장" || b.includes("별칭 등록")), buttons.join(","));
    assert.doesNotMatch(html, /placeholder="example.com"/, "도메인 입력칸 없음");
    assert.match(html, /트래커 설정은 관리자만 바꿀 수 있습니다/);
    assert.match(html, /shop\.example\.test/, "허용 도메인은 보인다");
    assert.match(html, /<textarea[^>]*readOnly=""|<textarea[^>]*readonly=""/i, "제외 경로는 읽기 전용");
    assert.match(html, /fake-site-key/, "설치 스크립트 복사는 유지");
});

test("UX-272 최근 한도 초과가 있으면 설정 화면에 버려진 요청 수를 경고한다", () => {
    assert.doesNotMatch(render(), /요청 한도 초과/);
    const html = render({ site: { ...site, rateLimited: { count: 1234, lastAt: "2026-10-25T01:05:00Z" } } });
    assert.match(html, /요청 한도 초과로 수집·식별 요청 1,234건이 버려졌습니다/);
    assert.match(html, /10:05/, "마지막 시각은 KST");
});
