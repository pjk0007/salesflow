import { test } from "node:test";
import assert from "node:assert";
import { AI_MODELS, DEFAULT_MODEL_ID, SEARCH_MODEL_ID, resolveModel } from "./models";

test("claude-haiku-4-5를 지정하면 provider claude 항목을 반환한다 (B1)", () => {
    const m = resolveModel("claude-haiku-4-5");
    assert.equal(m.id, "claude-haiku-4-5");
    assert.equal(m.provider, "claude");
});

test("미지정이면 기본 모델(Claude)을 반환한다 (B2)", () => {
    const m = resolveModel(undefined);
    assert.equal(m.id, DEFAULT_MODEL_ID);
    assert.equal(m.provider, "claude");
});

test("빈 문자열/미등록 모델은 기본 모델로 폴백한다 (B2)", () => {
    assert.equal(resolveModel("").id, DEFAULT_MODEL_ID);
    assert.equal(resolveModel("존재하지-않는-모델").id, DEFAULT_MODEL_ID);
});

// 운영 DB에 gemini-3.5-flash-lite가 12건 저장돼 있다.
// 목록에서 빼면 그 규칙들이 조용히 Claude로 바뀐다 — 기본값 폴백이 아님을 못 박는다.
test("기존 저장값 gemini-3.5-flash-lite는 그대로 gemini 항목을 반환한다 (B3)", () => {
    const m = resolveModel("gemini-3.5-flash-lite");
    assert.equal(m.id, "gemini-3.5-flash-lite");
    assert.equal(m.provider, "gemini");
    assert.notEqual(m.id, DEFAULT_MODEL_ID);
});

test("deepseek-v4-flash는 회귀 없이 deepseek 항목을 반환한다 (B16)", () => {
    const m = resolveModel("deepseek-v4-flash");
    assert.equal(m.id, "deepseek-v4-flash");
    assert.equal(m.provider, "deepseek");
});

test("AI_MODELS의 id는 중복되지 않는다", () => {
    const ids = AI_MODELS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
});

test("DEFAULT_MODEL_ID와 SEARCH_MODEL_ID는 AI_MODELS에 실재한다", () => {
    assert.ok(AI_MODELS.some((m) => m.id === DEFAULT_MODEL_ID));
    assert.ok(AI_MODELS.some((m) => m.id === SEARCH_MODEL_ID));
});

test("드롭다운 첫 항목이 Claude다 (B17)", () => {
    assert.equal(AI_MODELS[0].provider, "claude");
});
