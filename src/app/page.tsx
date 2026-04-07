"use client";

import { useSession } from "@/contexts/SessionContext";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import LandingPage from "@/components/landing/LandingPage";
import { Loader2 } from "lucide-react";
import HomeDashboard from "@/components/dashboard/HomeDashboard";

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
            <HomeDashboard />
        </WorkspaceLayout>
    );
}
