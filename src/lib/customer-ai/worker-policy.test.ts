import test from "node:test";
import assert from "node:assert/strict";
import { supportWorkerEnabled, supportWorkerWorkspaces } from "./worker-policy";

test("automatic support is limited to explicitly enabled businesses", () => {
    const env = {
        NODE_ENV: "production",
        CUSTOMER_AI_WORKER: "on",
        CUSTOMER_AI_WORKSPACES: "8,9",
    };
    assert.equal(supportWorkerEnabled(env), true);
    assert.equal(supportWorkerEnabled(env, 8), true);
    assert.equal(supportWorkerEnabled(env, 9), true);
    assert.equal(supportWorkerEnabled(env, 7), false);
    assert.equal(supportWorkerEnabled({ ...env, NODE_ENV: "test" }, 8), false);
    assert.equal(
        supportWorkerEnabled({ ...env, CUSTOMER_AI_WORKER: "off" }, 8),
        false,
    );
});

test("invalid explicit scopes fail closed and duplicates are removed", () => {
    assert.equal(supportWorkerWorkspaces(), null);
    assert.deepEqual(supportWorkerWorkspaces("8, 9,8"), [8, 9]);
    for (const value of [
        "",
        "*",
        "8,",
        "8,all",
        "0",
        "-1",
        "1.2",
        "9007199254740992",
    ]) {
        assert.deepEqual(supportWorkerWorkspaces(value), []);
        assert.equal(
            supportWorkerEnabled({
                NODE_ENV: "production",
                CUSTOMER_AI_WORKER: "on",
                CUSTOMER_AI_WORKSPACES: value,
            }),
            false,
        );
    }
});
