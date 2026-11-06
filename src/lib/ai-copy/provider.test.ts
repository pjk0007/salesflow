import test from "node:test";
import assert from "node:assert/strict";
import { acceptsTemperature } from "./provider";

test("Claude 5 계열에는 temperature 를 보내지 않는다 — 보내면 400 으로 전부 실패한다", () => {
    for (const model of ["claude-haiku-5-5", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"])
        assert.equal(acceptsTemperature(model), false, model);
});

test("4.x 이하 Claude 는 temperature 를 그대로 보낸다", () => {
    for (const model of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"])
        assert.equal(acceptsTemperature(model), true, model);
});
