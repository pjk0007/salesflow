"use client";

import { useState, useMemo } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import AlimtalkDashboard from "@/components/alimtalk/AlimtalkDashboard";
import SenderProfileList from "@/components/alimtalk/SenderProfileList";
import TemplateList from "@/components/alimtalk/TemplateList";
import AlimtalkTemplateLinkList from "@/components/alimtalk/AlimtalkTemplateLinkList";
import SendLogTable from "@/components/alimtalk/SendLogTable";
import AlimtalkConfigForm from "@/components/alimtalk/AlimtalkConfigForm";

export default function AlimtalkPage() {
    const [activeTab, setActiveTab] = useState("dashboard");
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
                    title="알림톡"
                    description="카카오 알림톡을 발송하고 관리합니다."
                />

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="dashboard">대시보드</TabsTrigger>
                        <TabsTrigger value="senders">발신프로필</TabsTrigger>
                        <TabsTrigger value="templates">템플릿</TabsTrigger>
                        <TabsTrigger value="links">연결 관리</TabsTrigger>
                        <TabsTrigger value="logs">발송 이력</TabsTrigger>
                        <TabsTrigger value="settings">설정</TabsTrigger>
                    </TabsList>

                    <TabsContent value="dashboard" className="mt-6">
                        <AlimtalkDashboard onTabChange={setActiveTab} />
                    </TabsContent>

                    <TabsContent value="senders" className="mt-6">
                        <SenderProfileList />
                    </TabsContent>

                    <TabsContent value="templates" className="mt-6">
                        <TemplateList />
                    </TabsContent>

                    <TabsContent value="links" className="mt-6">
                        <AlimtalkTemplateLinkList partitions={partitions} fields={fields} />
                    </TabsContent>

                    <TabsContent value="logs" className="mt-6">
                        <SendLogTable />
                    </TabsContent>

                    <TabsContent value="settings" className="mt-6">
                        <AlimtalkConfigForm />
                    </TabsContent>
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}
