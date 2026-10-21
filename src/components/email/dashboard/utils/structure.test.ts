import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
test("B25: 대시보드 TSX는 렌더만 하고 새 파일은 200줄 이하", () => {
    const ui = new URL("ui/", root);
    const files = readdirSync(ui).filter(file => file.endsWith(".tsx"));
    assert.equal(files.length, 12);
    for (const file of files) {
        const text = readFileSync(new URL(file, ui), "utf8");
        assert.doesNotMatch(text, /\buse(State|Effect|Memo|Callback|Reducer|Ref)\b|useSWR|\bfetch\(|Math\.|toFixed|toLocaleString/);
    }
    for (const folder of ["ui", "hooks", "api", "utils", "types", "../../../lib/email-stats", "../../../app/api/analytics/email-stats", "../../../app/api/analytics/email-stats/refresh", "../../../app/api/analytics/email-stats/process"]) {
        const dir = new URL(`${folder}/`, root);
        for (const file of readdirSync(dir).filter(file => /\.tsx?$/.test(file))) assert.ok(readFileSync(new URL(file, dir), "utf8").trimEnd().split("\n").length <= 200, file);
    }
});
test("B29: 이전 대시보드와 email-daily 경로를 제거한다", () => {
    for (const path of ["EmailDashboard.tsx", "DailyEmailTable.tsx", "../../hooks/useEmailDaily.ts", "../../hooks/useEmailAnalytics.ts", "../../app/api/analytics/email-daily/route.ts"]) {
        assert.equal(existsSync(new URL(`../${path}`, root)), false, path);
    }
});
