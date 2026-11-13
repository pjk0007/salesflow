"use client";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { InboxStatsPage } from "@/components/inbox-operations/ui/InboxStatsPage";
import { SWRConfig } from "swr";
export default function CustomerInboxStatsPage() {
    const { user, isSessionChanging, sessionEpoch } = useSession();
    return (
        <WorkspaceLayout>
            {user && !isSessionChanging && (
                <SWRConfig key={`${user.orgId}:${user.id}:${sessionEpoch}`} value={{ provider: () => new Map() }}>
                    <InboxStatsPage />
                </SWRConfig>
            )}
        </WorkspaceLayout>
    );
}
