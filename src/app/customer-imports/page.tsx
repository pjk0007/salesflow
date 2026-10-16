"use client";
import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { useSession } from "@/contexts/SessionContext";
import { ImportsPage } from "@/components/customer-imports/ui/ImportsPage";
export default function Page() {
    const { user } = useSession();
    return (
        <WorkspaceLayout>
            {user && (
                <Suspense>
                    <ImportsPage role={user.role} />
                </Suspense>
            )}
        </WorkspaceLayout>
    );
}
