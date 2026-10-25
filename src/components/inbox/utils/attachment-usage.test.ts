import test from "node:test";
import assert from "node:assert/strict";
import { attachmentUsageText, formatBytes } from "./attachment-usage";
test("UX-121 첨부 사용량 문구와 90% 경고", () => {
    assert.equal(formatBytes(0), "0B");
    assert.equal(formatBytes(1536), "1.5KB");
    assert.equal(formatBytes(2 * 1024 ** 3), "2GB");
    const low = attachmentUsageText(512 * 1024 ** 2, 2 * 1024 ** 3);
    assert.equal(low.warn, false);
    assert.match(low.text, /512MB \/ 2GB \(25%\)/);
    const high = attachmentUsageText(1.9 * 1024 ** 3, 2 * 1024 ** 3);
    assert.equal(high.warn, true);
    assert.match(high.text, /한도 조정/);
    assert.match(attachmentUsageText(3, 0).text, /\(0%\)/);
});
