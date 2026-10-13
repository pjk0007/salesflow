interface TimerHandle { unref?: () => void }
interface SchedulerOptions {
    deliver: () => Promise<unknown>;
    prepare: () => Promise<unknown>;
    schedule?: (callback: () => Promise<void>, delayMs: number) => TimerHandle;
    cancel?: (handle: TimerHandle) => void;
    onError?: (stage: "prepare" | "deliver") => void;
}

/** 느린 AI 준비와 예약 전송을 독립 실행한다. DB의 서로 다른 작업 잠금 + 원자적 큐 선점이 겹침을 막는다. */
export function createEmailSendScheduler(options: SchedulerOptions) {
    const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(() => { void callback(); }, delayMs));
    const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let stopped = false;
    let preparing = false;
    let timer: TimerHandle;
    const enqueue = (delay: number) => { timer = schedule(tick, delay); timer.unref?.(); };
    async function tick() {
        if (stopped) return;
        if (!preparing) {
            preparing = true;
            void Promise.resolve().then(options.prepare).catch(() => options.onError?.("prepare"))
                .finally(() => { preparing = false; });
        }
        try { await options.deliver(); }
        catch { options.onError?.("deliver"); }
        finally { if (!stopped) enqueue(30_000); }
    }
    enqueue(10_000);
    return { stop() { stopped = true; cancel(timer); } };
}

export function emailSendSchedulerEnabled(env: Record<string, string | undefined>) {
    if (env.NODE_ENV !== "production" || env.EMAIL_SEND_SCHEDULER === "off") return false;
    try { return new URL(env.NEXT_PUBLIC_BASE_URL ?? "").origin === "https://sendb.kr"; }
    catch { return false; }
}

type Scheduler = ReturnType<typeof createEmailSendScheduler>;
const server = globalThis as typeof globalThis & { __sendbEmailSendScheduler?: Scheduler };

export function startEmailSendScheduler() {
    if (server.__sendbEmailSendScheduler || !emailSendSchedulerEnabled(process.env)) return;
    server.__sendbEmailSendScheduler = createEmailSendScheduler({
        prepare: async () => (await import("./email-send-queue")).processEmailSendQueue(),
        deliver: async () => (await import("./email-send-queue")).processEmailSendQueue({ deliveryOnly: true }),
        onError: (stage) => console.error(`[email-send-scheduler] ${stage} 처리 실패 — 다음 회차에 재시도`),
    });
    console.info("[email-send-scheduler] 예약 전송 시작 — 준비와 별도로 30초마다 확인");
}
