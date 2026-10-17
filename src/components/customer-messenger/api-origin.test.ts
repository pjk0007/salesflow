import test from "node:test";
import assert from "node:assert/strict";
import { configureMessengerApiOrigin, messengerApiUrl } from "./api-origin";
test("self-hosted messenger sends only customer API paths to the configured origin and preserves the channel and query", () => {
    const path = "/api/messenger/" + "a".repeat(48) + "/attachments/file?conversationId=fictional";
    assert.equal(messengerApiUrl(path), path);
    try {
        configureMessengerApiOrigin("https://sendb.example.test");
        assert.equal(messengerApiUrl(path), "https://sendb.example.test" + path);
        assert.equal(messengerApiUrl("/api/inbox"), "/api/inbox");
        for (const bad of ["https://user:secret@example.test", "https://example.test/private", "https://example.test?secret=x", "http://example.test"])
            assert.throws(() => configureMessengerApiOrigin(bad));
        for (const bad of ["/api/messenger/invalid", "/api/messenger/" + "a".repeat(48) + "/../../../api/auth/me", path + "#token"])
            assert.throws(() => messengerApiUrl(bad));
        assert.equal(messengerApiUrl(path), "https://sendb.example.test" + path);
    } finally { configureMessengerApiOrigin(); }
    assert.equal(messengerApiUrl(path), path);
});
