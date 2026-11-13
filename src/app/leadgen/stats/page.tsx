"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { LeadgenStatsPage } from "@/components/leadgen/ui/LeadgenStatsPage";

export default function LeadgenStatsRoute() {
    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                <LeadgenStatsPage />
            </div>
        </WorkspaceLayout>
    );
}
