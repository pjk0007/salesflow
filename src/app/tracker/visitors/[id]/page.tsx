"use client";

import { use } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { VisitorDetailPage } from "@/components/tracker/ui/VisitorDetailPage";

export default function TrackerVisitorPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    const visitorPk = Number(id);

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader title="방문자 상세" />
                {visitorPk ? (
                    <VisitorDetailPage visitorPk={visitorPk} />
                ) : (
                    <p className="text-sm text-muted-foreground">잘못된 ID입니다.</p>
                )}
            </PageContainer>
        </WorkspaceLayout>
    );
}
