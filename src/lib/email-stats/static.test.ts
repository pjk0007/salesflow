import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
test("B10: 예약 연결·잠금·시간 제한·반납과 체험 서버 이전 등록", () => {
    const worker = read("./worker.ts");
    for (const token of ["pg_try_advisory_lock", "queryClient.reserve()", "statement_timeout", "RESET statement_timeout", "release()"]) assert.ok(worker.includes(token), token);
    const instrumentation = read("../../instrumentation.ts");
    assert.ok(instrumentation.indexOf("startEmailStatsScheduler") < instrumentation.indexOf("isDevelopmentPreviewRuntime"));
});
test("B11: 집계 GET은 원본 발송·클릭·오픈 표를 읽지 않는다", () => {
    for (const file of ["../../app/api/analytics/email-stats/route.ts", "./read-kpi.ts", "./read-series.ts", "./read-shared.ts", "./connections.ts", "./names.ts", "./home.ts", "../../app/api/analytics/summary/route.ts", "../../app/api/analytics/trends/route.ts", "../../app/api/analytics/templates/route.ts"]) {
        assert.doesNotMatch(read(file), /email_send_logs|email_click_logs|email_open_logs|emailSendLogs|emailClickLogs|emailOpenLogs/);
    }
});

test("B27: 홈과 대시보드는 15분 주기이며 포커스로 재요청하지 않는다", () => {
    for (const file of ["../../hooks/useAnalytics.ts", "../../components/email/dashboard/api/emailStatsApi.ts"]) {
        assert.match(read(file), /refreshInterval: 900000/);
        assert.match(read(file), /revalidateOnFocus: false/);
    }
});
