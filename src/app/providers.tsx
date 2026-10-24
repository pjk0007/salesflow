"use client";

import { useMemo } from "react";
import { toast, Toaster } from "sonner";
import { SWRConfig, useSWRConfig } from "swr";
import { ThemeProvider } from "next-themes";
import { SessionProvider, useSession } from "@/contexts/SessionContext";
import { createSwrErrorHandlers } from "@/lib/swr-fetcher";

function SwrErrorConfig({ children }: { children: React.ReactNode }) {
    const { cache } = useSWRConfig();
    const { refreshSession } = useSession();
    const value = useMemo(() => createSwrErrorHandlers({
        retry: SWRConfig.defaultValue.onErrorRetry,
        // 상담함처럼 별도 cache provider를 쓰는 화면은 자체 안내가 있어 여기서 알리지 않는다.
        hasData: (key) => cache.get(key)?.data !== undefined,
        // 세션이 만료됐으면 사용자 정보가 비워져 WorkspaceLayout이 로그인으로 보낸다.
        onUnauthorized: () => { void refreshSession(); },
        onStaleError: () => toast.error("최신 정보를 불러오지 못했습니다. 마지막으로 불러온 내용을 표시합니다.", { id: "swr-stale-data" }),
    }), [cache, refreshSession]);
    return <SWRConfig value={value}>{children}</SWRConfig>;
}

export default function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <SwrErrorConfig>
                <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                    {children}
                    <Toaster position="top-right" richColors />
                </ThemeProvider>
            </SwrErrorConfig>
        </SessionProvider>
    );
}
