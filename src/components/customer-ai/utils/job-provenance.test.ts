import { test } from "node:test";
import assert from "node:assert/strict";
import { supportJobCreatedAt, supportJobProvenance } from "./job-provenance";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SupportDraftPanel } from "../ui/SupportDraftPanel";
import type { Conversation } from "@/components/inbox/types";
const current = { originConversationId: "chat-current", fromMergedConversation: false };
const merged = { originConversationId: "chat-origin", fromMergedConversation: true };
test("원본ID와 병합표시가 모두 현재를 증명할 때만 현재 상담 행위 허용", () => {
    assert.equal(supportJobProvenance(current, "chat-current"), "current");
    assert.equal(supportJobProvenance(current, "chat-current", current), "current");
    assert.equal(supportJobProvenance(merged, "chat-current"), "merged");
});
test("과거ready/usable가 잘못돼도 원본ID 또는 병합표시로 읽기전용 판별", () => {
    const wrongReady = { originConversationId: "chat-origin", fromMergedConversation: false, state: "ready", usable: true };
    const wrongCurrentId = { originConversationId: "chat-current", fromMergedConversation: true, state: "ready", usable: true };
    assert.equal(supportJobProvenance(wrongReady, "chat-current"), "merged");
    assert.equal(supportJobProvenance(wrongCurrentId, "chat-current"), "merged");
});
test("목록/상세 출처가 다르면 더 보수적인 출처를 표시", () => {
    assert.equal(supportJobProvenance(current, "chat-current", merged), "merged");
    assert.equal(supportJobProvenance(merged, "chat-current", current), "merged");
    assert.equal(supportJobProvenance(current, "chat-current", {}), "unknown");
});
test("출처 필드 누락/잘못된 타입은 현재 초안으로 오인하지 않음", () => {
    for (const value of [{}, { originConversationId: "chat-current" }, { originConversationId: "chat-current", fromMergedConversation: "false" }, { originConversationId: null, fromMergedConversation: false }])
        assert.equal(supportJobProvenance(value, "chat-current"), "unknown");
});
test("생성 시각은 날짜와 초까지 표시하고 잘못된 날짜는 확인 안내", () => {
    const time = supportJobCreatedAt("2026-10-14T22:29:32+09:00");
    assert.match(time, /2026/);
    assert.match(time, /\d{2}:\d{2}:\d{2}/);
    assert.equal(supportJobCreatedAt("invalid"), "생성 시각 확인 안 됨");
});
test("기록을 아직 열지 않은 실제패널은 빈선택에서도 정상 렌더하고 현재 작업을 구분", () => {
    const html = renderToStaticMarkup(createElement(SupportDraftPanel, {
        chat: { id: "chat-current", aiState: "human", aiHandoffReason: null, status: "open" } as Conversation,
        messages: [], hasDraft: false, onUse: () => {}, onMode: async () => {},
    }));
    assert.match(html, /현재 상담 작업/);
    assert.match(html, /현재 상담 초안 생성/);
    assert.match(html, /현재 상담 AI 자동 응대 재개 허용/);
});
