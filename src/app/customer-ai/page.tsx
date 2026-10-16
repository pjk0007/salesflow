"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { CustomerAiPage } from "@/components/customer-ai/ui/CustomerAiPage";
export default function CustomerAiSettings() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <CustomerAiPage role={user.role} />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
