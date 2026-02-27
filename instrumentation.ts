export async function register() {
    console.log("[instrumentation] register() called, NEXT_RUNTIME:", process.env.NEXT_RUNTIME);
    if (process.env.NEXT_RUNTIME === "nodejs") {
        const { runMigrations } = await import("@/lib/db/migrate");
        await runMigrations();
    }
}
