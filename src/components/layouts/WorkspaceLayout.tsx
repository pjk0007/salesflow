"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/contexts/SessionContext";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

interface WorkspaceLayoutProps {
    children: React.ReactNode;
}

export default function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
    const router = useRouter();
    const { user, isLoading, sessionError, refreshSession } = useSession();

    useEffect(() => {
        if (!isLoading && !sessionError && !user) {
            // 보던 주소를 넘긴다 — 구글 챗 카드의 레코드 링크를 로그인 안 된 채 눌러도 로그인 뒤 그 레코드로 돌아오게 (DV-12)
            const here = `${window.location.pathname}${window.location.search}`;
            router.push(here && here !== "/" ? `/login?next=${encodeURIComponent(here)}` : "/login");
        } else if (!isLoading && !sessionError && user && !user.onboardingCompleted) {
            router.push("/onboarding");
        }
    }, [isLoading, sessionError, user, router]);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="text-muted-foreground">로딩 중...</div>
            </div>
        );
    }

    if (sessionError) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6">
                <QueryErrorState error={sessionError} onRetry={refreshSession} />
            </div>
        );
    }

    if (!user) return null;

    return <DashboardShell>{children}</DashboardShell>;
}

/** 빈 목록을 표시하기 전에 사용하는 공통 오류·재시도 표시. */
export function QueryErrorState({ error, onRetry }: { error: unknown; onRetry: () => unknown }) {
    const [pending, setPending] = useState(false);
    const [retryError, setRetryError] = useState<unknown>(null);
    const cause = retryError ?? error;
    const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
    return (
        <div className="flex flex-col items-center justify-center gap-4 p-6">
            <p role="alert" className="text-muted-foreground">{/[가-힣]/.test(message) ? message : "자료를 불러오지 못했습니다."}</p>
            <button type="button" className="rounded-md border px-4 py-2" disabled={pending}
                onClick={async () => {
                    if (pending) return;
                    setPending(true);
                    setRetryError(null);
                    try { await onRetry(); }
                    catch (cause) { setRetryError(cause); }
                    finally { setPending(false); }
                }}>
                {pending ? "불러오는 중..." : "다시 시도"}
            </button>
        </div>
    );
}
