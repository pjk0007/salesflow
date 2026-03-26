"use client";

import { useState, useMemo } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import AlimtalkDashboard from "@/components/alimtalk/AlimtalkDashboard";
import SenderProfileList from "@/components/alimtalk/SenderProfileList";
import TemplateList from "@/components/alimtalk/TemplateList";
import AlimtalkTemplateLinkList from "@/components/alimtalk/AlimtalkTemplateLinkList";
import SendLogTable from "@/components/alimtalk/SendLogTable";
import AlimtalkConfigForm from "@/components/alimtalk/AlimtalkConfigForm";

function useAllPartitions(workspaceIds: number[]) {
    const pt0 = usePartitions(workspaceIds[0] ?? null);
    const pt1 = usePartitions(workspaceIds[1] ?? null);
    const pt2 = usePartitions(workspaceIds[2] ?? null);
    const pt3 = usePartitions(workspaceIds[3] ?? null);
    const pt4 = usePartitions(workspaceIds[4] ?? null);

    return useMemo(() => {
        const all: { id: number; name: string; workspaceId: number }[] = [];
        for (const pt of [pt0, pt1, pt2, pt3, pt4]) {
            if (!pt.partitionTree) continue;
            const items = [
                ...pt.partitionTree.ungrouped,
                ...pt.partitionTree.folders.flatMap((f) => f.partitions),
            ];
            all.push(...items.map((p) => ({ id: p.id, name: p.name, workspaceId: p.workspaceId })));
        }
        return all;
    }, [pt0.partitionTree, pt1.partitionTree, pt2.partitionTree, pt3.partitionTree, pt4.partitionTree]);
}

export default function AlimtalkPage() {
    const [activeTab, setActiveTab] = useState("dashboard");
    const { workspaces } = useWorkspaces();
    const workspaceIds = useMemo(() => workspaces.map((w) => w.id), [workspaces]);
    const partitions = useAllPartitions(workspaceIds);

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
                        <AlimtalkTemplateLinkList partitions={partitions} />
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
