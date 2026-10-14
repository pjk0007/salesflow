"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { CustomerCrmPage } from "@/components/customer-crm/ui/CustomerCrmPage";
export default function Page() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <CustomerCrmPage role={user.role} />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
