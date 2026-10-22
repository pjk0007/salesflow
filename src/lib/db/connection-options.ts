/** 2026-10-22: a slow query must not occupy the shared application pool forever. */
export function statementTimeoutMs(raw = process.env.DATABASE_STATEMENT_TIMEOUT_MS): number {
    const value = (raw ?? "").trim();
    const n = /^\d+$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(n) && n <= 3_600_000 ? n : 60_000;
}

export function poolMax(raw = process.env.DATABASE_POOL_MAX): number {
    const value = (raw ?? "").trim();
    const n = /^\d+$/.test(value) ? Number(value) : NaN;
    return Number.isSafeInteger(n) && n >= 5 && n <= 200 ? n : 20;
}
