import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";

const read = (path: string) => readFileSync(path, "utf8");
const sendFiles = [
    "src/lib/email-automation.ts", "src/app/api/email/send/route.ts", "src/lib/auto-personalized-email.ts",
    "src/lib/email-followup.ts", "src/lib/email-visit-ack-delivery.ts", "src/app/api/email/auto-personalized/test-followup/route.ts",
];
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = posix.join(dir, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) && !path.endsWith(".test.ts") ? [path] : [];
    });
}
test("B4: 7개 발송 경로는 공통 추적만 호출", () => {
    let calls = 0;
    for (const path of sendFiles) {
        const text = read(path);
        assert.match(text, /\bapplyEmailTracking\(/, path);
        assert.doesNotMatch(text, /\bwrapTrackingUrls\(/, path);
        calls += [...text.matchAll(/\bapplyEmailTracking\(/g)].length;
    }
    assert.equal(calls, 7);
    assert.deepEqual(sourceFiles("src").filter(path => /\bwrapTrackingUrls\(/.test(read(path))), ["src/lib/email-click-tracking.ts"]);
});
test("B18: 모든 발송 insert는 openTracked를 명시", () => {
    for (const path of sendFiles.filter(path => !path.includes("visit-ack"))) {
        assert.equal([...read(path).matchAll(/openTracked: true/g)].length, path.includes("email-followup.ts") ? 2 : 1, path);
    }
    const visit = read("src/lib/email-visit-ack-delivery.ts");
    assert.match(visit, /sender_email,\s*open_tracked\)/);
    assert.match(visit, /,\s*true\s+FROM owned/);
});
test("B5: insert 뒤에만 픽셀을 입힌다", () => {
    for (const path of sendFiles) {
        const text = read(path);
        // 보내지 않은 건의 실패 이력(처음부터 status "failed"로 넣는 insert)은 발송이 아니라 픽셀 대상에서 뺀다 (UX-163)
        const inserts = [...text.matchAll(/insert\(emailSendLogs\)|INSERT INTO email_send_logs/g)]
            .filter(match => !/^[^;]*?status:\s*"failed"/.test(text.slice(match.index, match.index + 800).split(/\}\)\s*;/)[0]))
            .map(match => match.index);
        const applies = [...text.matchAll(/\bapplyEmailTracking\(/g)].map(match => match.index);
        assert.equal(applies.length, inserts.length, path);
        for (let i = 0; i < applies.length; i++) assert.ok(applies[i] > inserts[i], path);
    }
});
test("B2: 링크 래핑 뒤 픽셀 삽입", () => {
    assert.ok(read("src/lib/email-click-tracking.ts").includes("return appendOpenPixel(wrapTrackingUrls(html, sendLogId), sendLogId);"));
});
test("B3·B6·B9: 상수 시간 서명, 쿠키·대기 없는 응답, 잠금 없는 기록", () => {
    assert.match(read("src/lib/email-open-pixel.ts"), /timingSafeEqual\(/);
    assert.doesNotMatch(read("src/lib/email-open-tracking.ts"), /\.transaction\(|advisory/i);
    const route = read("src/app/api/track/open/route.ts");
    assert.match(route, /after\(\(\) => recordOpenSafely\(/);
    assert.match(route, /export function HEAD\(/);
    assert.doesNotMatch(route, /\bawait\b|cookie/i);
});
test("B16: 판정은 import와 NHN 오픈 값에 의존하지 않는다", () => {
    assert.doesNotMatch(read("src/lib/email-open-rules.ts"), /^\s*import\s/m);
    assert.deepEqual(sourceFiles("src").filter(path => /\b(isOpened|openedDate)\b/.test(read(path))), ["src/lib/nhn-email.ts"]);
});
test("B29: 두 로그 표는 오픈 판정 없이 공통 칸을 사용", () => {
    for (const path of ["src/components/email/EmailSendLogTable.tsx", "src/components/logs/UnifiedLogTable.tsx"]) {
        assert.ok(read(path).includes("<OpenCountCell log={log} />"), path);
        assert.doesNotMatch(read(path), /openCount|machineOpenCount|openTracked/);
    }
});
