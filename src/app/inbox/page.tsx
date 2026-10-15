"use client";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { InboxPage } from "@/components/inbox/ui/InboxPage";
import { Suspense } from "react";
import { SWRConfig } from "swr";
export default function CustomerInboxPage() {
    const { user, isSessionChanging, sessionEpoch, subscribeInvalidation } = useSession();
    return (
        <WorkspaceLayout>
            {user && !isSessionChanging && (
                <Suspense>
                    <SWRConfig key={`${user.orgId}:${user.id}:${sessionEpoch}`} value={{ provider: () => new Map() }}>
                        <InboxPage userId={user.id} orgId={user.orgId} role={user.role} subscribeSessionInvalidation={subscribeInvalidation} />
                    </SWRConfig>
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
