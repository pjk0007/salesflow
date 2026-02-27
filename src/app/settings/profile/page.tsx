"use client";

import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import ProfileTab from "@/components/settings/ProfileTab";

export default function ProfileSettingsPage() {
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="프로필 설정"
                    description="계정 정보를 관리합니다."
                />
                <ProfileTab />
            </PageContainer>
        </WorkspaceLayout>
    );
}
