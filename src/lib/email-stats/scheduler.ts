import { describeReplyError } from "../email-reply-rules";
import { createJourneyScheduler } from "../customer-journey-scheduler";
import type { EmailStatsRunStats } from "./worker-types";

export function emailStatsSchedulerEnabled(env: Record<string, string | undefined>): boolean {
    if (env.EMAIL_STATS_WORKER === "on")
        return true;
    if (env.EMAIL_STATS_WORKER === "off")
        return false;
    return env.NODE_ENV === "production";
}

export function emailStatsInterval(env: Record<string, string | undefined>): number {
    const value = Number(env.EMAIL_STATS_INTERVAL_MS);
    return Number.isInteger(value) && value >= 60000 && value <= 3600000 ? value : 900000;
}
type Scheduler = ReturnType<typeof createJourneyScheduler<EmailStatsRunStats>>;
const server = globalThis as typeof globalThis & {
    __sendbEmailStatsScheduler?: Scheduler;
};

export function startEmailStatsScheduler() {
    if (server.__sendbEmailStatsScheduler || !emailStatsSchedulerEnabled(process.env))
        return;
    server.__sendbEmailStatsScheduler = createJourneyScheduler<EmailStatsRunStats>({
        run: async () => (await import("./worker")).runEmailStats(),
        intervalMs: emailStatsInterval(process.env),
        firstDelayMs: 30000,
        failureLabel: "이메일 통계 정기 처리 실패",
        onError: (error) => console.error(`[email-stats] 정기 처리 실패: ${describeReplyError(error).replace(/[\r\n]+/g, " ")} — 다음 회차에 다시 시도`),
    });
}
