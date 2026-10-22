"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
                <p role="alert" className="text-muted-foreground">{sessionError}</p>
                <button type="button" className="rounded-md border px-4 py-2" onClick={() => void refreshSession()}>
                    다시 시도
                </button>
            </div>
        );
    }

    if (!user) return null;

    return <DashboardShell>{children}</DashboardShell>;
}
