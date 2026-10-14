"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { WebhooksPage } from "@/components/customer-webhooks/ui/WebhooksPage";
export default function CustomerWebhooksPage() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <WebhooksPage role={user.role} />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
