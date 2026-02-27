"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import UnifiedLogTable from "@/components/logs/UnifiedLogTable";

export default function LogsPage() {
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="발송 이력"
                    description="알림톡/이메일 통합 발송 이력"
                />
                <UnifiedLogTable />
            </PageContainer>
        </WorkspaceLayout>
    );
}
