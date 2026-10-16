/** The separately hosted Sendb development service never starts background workers. */
export function isDevelopmentPreviewRuntime(
    env: Record<string, string | undefined>,
): boolean {
    try {
        return new URL(env.NEXT_PUBLIC_APP_URL ?? "").origin ===
            "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app";
    } catch {
        return false;
    }
}
