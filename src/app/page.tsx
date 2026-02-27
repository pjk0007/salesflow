"use client";

import { useSession } from "@/contexts/SessionContext";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import HomeDashboard from "@/components/dashboard/HomeDashboard";
import LandingPage from "@/components/landing/LandingPage";
import { Loader2 } from "lucide-react";

export default function HomePage() {
    const { user, isLoading } = useSession();

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user) {
        return <LandingPage />;
    }

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="홈"
                    description="전체 현황을 한눈에 확인하세요."
                />
                <HomeDashboard />
            </PageContainer>
        </WorkspaceLayout>
    );
}
