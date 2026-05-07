"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { VisitorListPage } from "@/components/tracker/ui/VisitorListPage";

export default function TrackerPage() {
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="트래커"
                    description="이메일 클릭 후 사이트에 들어온 방문자의 행동을 추적합니다."
                />
                <VisitorListPage />
            </PageContainer>
        </WorkspaceLayout>
    );
}
