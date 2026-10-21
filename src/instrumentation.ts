export async function register() {
    console.log("[instrumentation] register() called, NEXT_RUNTIME:", process.env.NEXT_RUNTIME);
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { runMigrations } = await import("@/lib/db/migrate");
        const migrated = await runMigrations();
        if (!migrated) {
            // 스키마와 코드가 어긋난 채로 띄우지 않는다 (F1·OPS-1) — 옛 스키마로 뜨면 발송 기록 insert가 모두 42703으로 실패한다.
            // 끝내면 플랫폼이 다시 띄우며 마이그레이션을 다시 한다. 급할 때만 MIGRATION_FAILURE_MODE=continue로 예전처럼 띄운다
            if ((process.env.MIGRATION_FAILURE_MODE ?? "").trim().toLowerCase() === "continue") {
                console.error("[instrumentation] 마이그레이션 실패 — MIGRATION_FAILURE_MODE=continue라 그대로 띄움 (새 칸을 쓰는 경로가 실패할 수 있음)");
            } else {
                console.error("[instrumentation] 마이그레이션 실패 — 서버를 띄우지 않고 끝냅니다 (다시 띄우면 다시 시도)");
                process.exit(1);
            }
        }
        // email_send_logs 색인은 마이그레이션 뒤 트랜잭션 밖에서 CONCURRENTLY로 (DESIGN-SND 8-3). 기다리지 않는다 — 서버가 뜨는 것을 늦추지 않게
        const { ensureSendLogIndexes } = await import("@/lib/db/send-log-indexes");
        void ensureSendLogIndexes();
        const { startEmailStatsScheduler } = await import("@/lib/email-stats/scheduler");
        startEmailStatsScheduler();
        const { isDevelopmentPreviewRuntime } = await import("@/lib/development-runtime");
        if (isDevelopmentPreviewRuntime(process.env)) {
            console.info("[instrumentation] sendb-dev 체험 서버 — 자동 발송·AI·외부 연동 워커를 시작하지 않습니다.");
            return;
        }
        if (process.env.ESIGN_ENABLED === "on" && process.env.ESIGN_WORKER === "on") {
            const { startEsignScheduler } = await import("@/lib/esign/runtime");
            startEsignScheduler();
        }
        const { startCustomerJourneyScheduler } = await import("@/lib/customer-journey-scheduler");
        startCustomerJourneyScheduler();
        const { startEmailSendScheduler } = await import("@/lib/email-send-scheduler");
        startEmailSendScheduler();
        const { startCopyEvaluationScheduler } = await import("@/lib/ai-copy/worker");
        startCopyEvaluationScheduler();
        const { startCopyAutomationScheduler } = await import("@/lib/ai-copy/automation-worker");
        startCopyAutomationScheduler();
        const { startWebhookScheduler } = await import("@/lib/customer-platform/webhook-worker");
        startWebhookScheduler();
        const { startSupportAiScheduler } = await import("@/lib/customer-ai/worker");
        startSupportAiScheduler();
        const { startCustomerReplyNotificationScheduler } = await import("@/lib/customer-messenger/worker");
        startCustomerReplyNotificationScheduler();
        const { startWorkflowScheduler } = await import("@/lib/customer-workflows/worker");
        startWorkflowScheduler();
        const { startGoogleMailScheduler } = await import("@/lib/inbox-email/google-worker");
        startGoogleMailScheduler();
        const {startOperationsScheduler}=await import("@/lib/inbox-operations/worker");
        startOperationsScheduler();
        const { startInboxChatAlertScheduler } = await import("@/lib/inbox-chat-alerts/worker");
        startInboxChatAlertScheduler();
        const {startRoutingScheduler}=await import("@/lib/inbox-capacity/dispatcher");
        startRoutingScheduler();
    }
}
