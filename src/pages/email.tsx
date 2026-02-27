import { useMemo } from "react";
import { useRouter } from "next/router";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import EmailDashboard from "@/components/email/EmailDashboard";
import EmailTemplateList from "@/components/email/EmailTemplateList";
import EmailTemplateLinkList from "@/components/email/EmailTemplateLinkList";
import EmailSendLogTable from "@/components/email/EmailSendLogTable";
import EmailConfigForm from "@/components/email/EmailConfigForm";
import EmailCategoryManager from "@/components/email/EmailCategoryManager";

export default function EmailPage() {
    const router = useRouter();
    const activeTab = (router.query.tab as string) || "dashboard";
    const setActiveTab = (tab: string) => {
        router.replace({ pathname: "/email", query: { tab } }, undefined, { shallow: true });
    };
    const { workspaces } = useWorkspaces();
    const firstWorkspaceId = workspaces?.[0]?.id ?? null;
    const { partitionTree } = usePartitions(firstWorkspaceId);
    const { fields } = useFields(firstWorkspaceId);

    const partitions = useMemo(() => {
        if (!partitionTree) return [];
        const all = [
            ...partitionTree.ungrouped,
            ...partitionTree.folders.flatMap((f) => f.partitions),
        ];
        return all.map((p) => ({ id: p.id, name: p.name }));
    }, [partitionTree]);

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
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}
