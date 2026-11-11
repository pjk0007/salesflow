"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { LeadStatsPage } from "@/components/leads/ui/stats/LeadStatsPage";

export default function LeadsStatsRoute() {
    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                <LeadStatsPage />
            </div>
        </WorkspaceLayout>
    );
}
