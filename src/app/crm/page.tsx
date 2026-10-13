"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import JourneyAlertTable from "@/components/crm/ui/JourneyAlertTable";

export default function CrmPage() {
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader title="CRM 관리" />
                <JourneyAlertTable />
            </PageContainer>
        </WorkspaceLayout>
    );
}
