"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { CustomerCrmPage } from "@/components/customer-crm/ui/CustomerCrmPage";
export default function CustomerContactsPage() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <CustomerCrmPage role={user.role} userId={user.id} contactsOnly />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
