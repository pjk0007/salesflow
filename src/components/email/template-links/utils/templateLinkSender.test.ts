import { test } from "node:test";
import assert from "node:assert/strict";
import { isManualTrigger, templateLinkSenderBody } from "./templateLinkSender";

test("templateLinkSenderBody: automatic links include selected or empty pool (B21/B22/B5)", () => {
    for (const trigger of ["on_create", "on_update"]) {
        for (const ids of [[8, 7], []]) {
            const body = templateLinkSenderBody(trigger, ids);
            assert.deepEqual(body, { senderProfileIds: ids });
            assert.notEqual(body.senderProfileIds, ids);
        }
    }
});

test("templateLinkSenderBody: manual links omit sender field (B27/B6)", () => {
    for (const ids of [[8, 7], []]) {
        const body = templateLinkSenderBody("manual", ids);
        assert.deepEqual(body, {});
        assert.equal("senderProfileIds" in body, false);
    }
});

test("isManualTrigger: only manual is manual (B27)", () => {
    assert.equal(isManualTrigger("manual"), true);
    for (const trigger of ["on_create", "on_update", "", "MANUAL"]) {
        assert.equal(isManualTrigger(trigger), false);
    }
});
