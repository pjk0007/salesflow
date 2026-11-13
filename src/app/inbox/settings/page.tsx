"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { InboxSettingsPage } from "@/components/inbox/ui/InboxSettingsPage";
import { SWRConfig } from "swr";
export default function CustomerInboxSettingsPage() {
    const { user, isSessionChanging, sessionEpoch } = useSession();
    return (
        <WorkspaceLayout>
            {user && !isSessionChanging && (
                <Suspense>
                    <SWRConfig key={`${user.orgId}:${user.id}:${sessionEpoch}`} value={{ provider: () => new Map() }}>
                        <InboxSettingsPage />
                    </SWRConfig>
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
