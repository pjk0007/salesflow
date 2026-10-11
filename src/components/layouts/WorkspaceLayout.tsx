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
    const { user, isLoading } = useSession();

    useEffect(() => {
        if (!isLoading && !user) {
            // 보던 주소를 넘긴다 — 구글 챗 카드의 레코드 링크를 로그인 안 된 채 눌러도 로그인 뒤 그 레코드로 돌아오게 (DV-12)
            const here = `${window.location.pathname}${window.location.search}`;
            router.push(here && here !== "/" ? `/login?next=${encodeURIComponent(here)}` : "/login");
        } else if (!isLoading && user && !user.onboardingCompleted) {
            router.push("/onboarding");
        }
    }, [isLoading, user, router]);

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="text-muted-foreground">로딩 중...</div>
            </div>
        );
    }

    if (!user) return null;

    return <DashboardShell>{children}</DashboardShell>;
}
