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
            router.push("/login");
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
