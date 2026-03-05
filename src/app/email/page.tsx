"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useFields } from "@/hooks/useFields";
import EmailDashboard from "@/components/email/EmailDashboard";
import EmailTemplateList from "@/components/email/EmailTemplateList";
import EmailTemplateLinkList from "@/components/email/EmailTemplateLinkList";
import EmailSendLogTable from "@/components/email/EmailSendLogTable";
import EmailConfigForm from "@/components/email/EmailConfigForm";
import EmailCategoryManager from "@/components/email/EmailCategoryManager";
import AutoPersonalizedEmailConfig from "@/components/email/AutoPersonalizedEmailConfig";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function EmailPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeTab = searchParams.get("tab") || "dashboard";
    const setActiveTab = (tab: string) => {
        router.replace(`/email?tab=${tab}`);
    };
    const { workspaces } = useWorkspaces();
    const firstWorkspaceId = workspaces?.[0]?.id ?? null;
    const { fields } = useFields(firstWorkspaceId);

    // 조직 내 모든 파티션 조회
    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);

    const partitions = useMemo(() => {
        const items: Array<{ id: number; name: string; workspaceId: number; workspaceName: string }> = allPartitionsData?.data ?? [];
        const hasMultipleWorkspaces = new Set(items.map((p) => p.workspaceId)).size > 1;
        return items.map((p) => ({
            id: p.id,
            name: hasMultipleWorkspaces ? `[${p.workspaceName}] ${p.name}` : p.name,
        }));
    }, [allPartitionsData]);

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="이메일"
                    description="NHN Cloud Email을 통해 이메일을 발송하고 관리합니다."
                />

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="dashboard">대시보드</TabsTrigger>
                        <TabsTrigger value="templates">템플릿</TabsTrigger>
                        <TabsTrigger value="links">연결 관리</TabsTrigger>
                        <TabsTrigger value="logs">발송 이력</TabsTrigger>
                        <TabsTrigger value="settings">설정</TabsTrigger>
                        <TabsTrigger value="ai-auto">AI 자동발송</TabsTrigger>
                    </TabsList>

                    <TabsContent value="dashboard" className="mt-6">
                        <EmailDashboard onTabChange={setActiveTab} />
                    </TabsContent>

                    <TabsContent value="templates" className="mt-6">
                        <EmailTemplateList />
                    </TabsContent>

                    <TabsContent value="links" className="mt-6">
                        <EmailTemplateLinkList partitions={partitions} fields={fields} />
                    </TabsContent>

                    <TabsContent value="logs" className="mt-6">
                        <EmailSendLogTable />
                    </TabsContent>

                    <TabsContent value="settings" className="mt-6 space-y-6">
                        <EmailConfigForm />
                        <EmailCategoryManager />
                    </TabsContent>

                    <TabsContent value="ai-auto" className="mt-6">
                        <AutoPersonalizedEmailConfig partitions={partitions} fields={fields} />
                    </TabsContent>
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}

export default function EmailPage() {
    return (
        <Suspense>
            <EmailPageContent />
        </Suspense>
    );
}
