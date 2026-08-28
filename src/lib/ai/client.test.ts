import { test } from "node:test";
import assert from "node:assert";
import { getAiClient, getSearchAiClient } from "./client";
import { SEARCH_MODEL_ID } from "./models";

// process.env를 직접 조작하고 매 테스트 후 원복한다.
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) {
        saved[k] = process.env[k];
        if (vars[k] === undefined) delete process.env[k];
        else process.env[k] = vars[k];
    }
    try {
        fn();
    } finally {
        for (const k of Object.keys(saved)) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    }
}

test("ANTHROPIC_API_KEY가 있으면 claude 클라이언트를 만든다 (B4)", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-test" }, () => {
        const c = getAiClient("claude-haiku-4-5");
        assert.ok(c);
        assert.equal(c.provider, "claude");
        assert.equal(c.apiKey, "sk-test");
        assert.equal(c.model, "claude-haiku-4-5");
    });
});

test("ANTHROPIC_API_KEY가 없으면 null을 반환한다 (B5)", () => {
    withEnv({ ANTHROPIC_API_KEY: undefined }, () => {
        assert.equal(getAiClient("claude-haiku-4-5"), null);
    });
});

test("getSearchAiClient가 Claude 클라이언트를 반환한다 (B6)", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-test" }, () => {
        const c = getSearchAiClient();
        assert.ok(c);
        assert.equal(c.provider, "claude");
        assert.equal(c.model, SEARCH_MODEL_ID);
    });
});

test("ANTHROPIC_API_KEY가 없으면 getSearchAiClient도 null이다 (B5)", () => {
    withEnv({ ANTHROPIC_API_KEY: undefined }, () => {
        assert.equal(getSearchAiClient(), null);
    });
});

test("모델 미지정이면 기본값(Claude)으로 클라이언트를 만든다 (B2/B4)", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-test" }, () => {
        const c = getAiClient();
        assert.ok(c);
        assert.equal(c.provider, "claude");
    });
});

test("deepseek 모델은 여전히 DEEPSEEK_API_KEY를 읽는다 (B16)", () => {
    withEnv({ DEEPSEEK_API_KEY: "ds-test", ANTHROPIC_API_KEY: undefined }, () => {
        const c = getAiClient("deepseek-v4-flash");
        assert.ok(c);
        assert.equal(c.provider, "deepseek");
        assert.equal(c.apiKey, "ds-test");
    });
});

test("gemini 모델은 여전히 GEMINI_API_KEY를 읽는다 (B3)", () => {
    withEnv({ GEMINI_API_KEY: "gm-test", ANTHROPIC_API_KEY: undefined }, () => {
        const c = getAiClient("gemini-3.5-flash-lite");
        assert.ok(c);
        assert.equal(c.provider, "gemini");
        assert.equal(c.apiKey, "gm-test");
    });
});
