import { journeyAlertConfig } from "./customer-journey-alert-config";
import { isProductionServer } from "./deep-visitor-alert-rules";
import type { JourneyAlertStats } from "./customer-journey-alert";

interface TimerHandle { unref?: () => void }
interface SchedulerState {
    running: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastResult: JourneyAlertStats | null;
    lastError: string | null;
}
interface SchedulerOptions {
    run: () => Promise<JourneyAlertStats>;
    schedule?: (callback: () => Promise<void>, delayMs: number) => TimerHandle;
    cancel?: (handle: TimerHandle) => void;
    now?: () => Date;
    onResult?: (result: JourneyAlertStats) => void;
    onError?: () => void;
}

/** 완료 후 다음 회차를 예약한다. 오래 걸리는 회차와 다음 회차를 한 프로세스에서 겹치지 않는다. */
export function createJourneyScheduler(options: SchedulerOptions) {
    const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(() => { void callback(); }, delayMs));
    const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const now = options.now ?? (() => new Date());
    const state: SchedulerState = { running: false, lastStartedAt: null, lastCompletedAt: null, lastResult: null, lastError: null };
    let stopped = false;
    let timer: TimerHandle;
    const enqueue = (delayMs: number) => { timer = schedule(tick, delayMs); timer.unref?.(); };
    async function tick() {
        if (stopped) return;
        state.running = true;
        state.lastStartedAt = now().toISOString();
        try {
            state.lastResult = await options.run();
            state.lastError = null;
            options.onResult?.(state.lastResult);
        } catch {
            state.lastError = "고객 여정 정기 처리 실패";
            options.onError?.();
        } finally {
            state.running = false;
            state.lastCompletedAt = now().toISOString();
            if (!stopped) enqueue(5 * 60 * 1000);
        }
    }
    enqueue(20_000);
    return { state, stop() { stopped = true; cancel(timer); } };
}

type Scheduler = ReturnType<typeof createJourneyScheduler>;
const server = globalThis as typeof globalThis & { __sendbJourneyScheduler?: Scheduler };

export function journeySchedulerEnabled(env: Record<string, string | undefined>) {
    const config = journeyAlertConfig(env);
    return env.JOURNEY_ALERT_SCHEDULER === "on" && isProductionServer(env) && config.mode !== "off" && config.ids.length > 0 && !config.configurationError;
}

/** Next의 계측·라우트가 별도 번들로 로드되어도 서버 프로세스당 한 번만 시작한다. */
export function startCustomerJourneyScheduler() {
    if (server.__sendbJourneyScheduler || !journeySchedulerEnabled(process.env)) return;
    server.__sendbJourneyScheduler = createJourneyScheduler({
        run: async () => (await import("./customer-journey-alert")).processCustomerJourneyAlerts(),
        onResult: (result) => console.info("[customer-journey] 정기 처리 완료", JSON.stringify(result)),
        onError: () => console.error("[customer-journey] 정기 처리 실패 — 5분 뒤 다시 시도"),
    });
    console.info("[customer-journey] 정기 처리 시작 — 첫 회차 20초 후, 이후 완료 시점부터 5분 간격");
}

export function customerJourneySchedulerStatus() {
    const scheduler = server.__sendbJourneyScheduler;
    return scheduler ? { enabled: true, ...scheduler.state } : { enabled: false };
}
