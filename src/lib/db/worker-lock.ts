import postgres from "postgres";

interface LockConnection {
    tryLock(key: number): Promise<boolean>;
    close(): Promise<void>;
}
export interface WorkerLock { release(): Promise<void> }

/**
 * A lock-only worker must not reserve an application connection and then wait for
 * another application connection to do its work. Cap lock sessions separately.
 * Different jobs wait FIFO without holding a DB connection; duplicate rounds
 * skip instead of adding more waiters. A busy worker cannot starve later jobs.
 */
export function createWorkerLockManager(createConnection: () => LockConnection, capacity = 4) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("worker lock capacity must be positive");
    const active = new Set<number>();
    const waiting: Array<() => void> = [];
    let sessions = 0;
    return {
        async acquire(key: number): Promise<WorkerLock | null> {
            if (active.has(key)) return null;
            active.add(key);
            if (sessions >= capacity) await new Promise<void>((resolve) => waiting.push(resolve));
            else sessions++;
            let connection: LockConnection | undefined;
            let closing: Promise<void> | undefined;
            const release = () => closing ??= (async () => {
                await connection?.close();
                active.delete(key);
                const next = waiting.shift();
                if (next) next(); // transfer this slot, rather than racing new arrivals
                else sessions--;
            })().catch((error) => {
                // Do not admit another session while this one may still exist.
                // The owner may retry close; successful repeated close is idempotent.
                closing = undefined;
                throw error;
            });
            try {
                connection = createConnection();
                if (await connection.tryLock(key)) return { release };
                await release();
                return null;
            } catch (error) {
                await release();
                throw error;
            }
        },
    };
}

/** Closing the owned session releases its lock even when an UNLOCK query fails.
 * It never closes or returns a locked session to the application query pool. */
export function workerLockConnection(url: string): LockConnection {
    const client = postgres(url, {
        max: 1, connect_timeout: 10, max_lifetime: 0, idle_timeout: 0,
        connection: { statement_timeout: 10_000, application_name: "sendb-worker-lock" },
        onnotice: () => {},
    });
    return {
        async tryLock(key) {
            const [row] = await client<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(${key}) AS acquired`;
            return row?.acquired === true;
        },
        async close() { await client.end({ timeout: 0 }); },
    };
}

const server = globalThis as typeof globalThis & {
    __sendbWorkerLocks?: ReturnType<typeof createWorkerLockManager>;
};
export function acquireWorkerLock(key: number) {
    server.__sendbWorkerLocks ??= createWorkerLockManager(() => {
        if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 환경 변수가 설정되지 않았습니다.");
        return workerLockConnection(process.env.DATABASE_URL);
    });
    return server.__sendbWorkerLocks.acquire(key);
}
