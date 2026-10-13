"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import JourneyAlertTable from "@/components/crm/ui/JourneyAlertTable";

export default function CrmPage() {
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="CRM 관리"
                    description="고객 여정 알림 목록 — 사이트 방문 고객의 행동을 확인하고 후속 조치를 취할 수 있습니다."
                />
                <JourneyAlertTable />
            </PageContainer>
        </WorkspaceLayout>
    );
}
