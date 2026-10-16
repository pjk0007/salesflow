"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { WorkflowsPage } from "@/components/customer-workflows/ui/WorkflowsPage";
export default function Page() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <WorkflowsPage role={user.role} />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
