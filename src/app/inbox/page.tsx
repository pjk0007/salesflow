"use client";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { InboxPage } from "@/components/inbox/ui/InboxPage";
import { Suspense } from "react";
export default function CustomerInboxPage() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <InboxPage userId={user.id} role={user.role} />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
