"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AlimtalkDashboard from "@/components/alimtalk/AlimtalkDashboard";
import SenderProfileList from "@/components/alimtalk/SenderProfileList";
import TemplateList from "@/components/alimtalk/TemplateList";
import AlimtalkTemplateLinkList from "@/components/alimtalk/AlimtalkTemplateLinkList";
import SendLogTable from "@/components/alimtalk/SendLogTable";
import AlimtalkConfigForm from "@/components/alimtalk/AlimtalkConfigForm";
import { defaultFetcher } from "@/lib/swr-fetcher";

const VALID_TABS = ["dashboard", "senders", "templates", "links", "logs", "settings"] as const;

export default function AlimtalkPage() {
    const searchParams = useSearchParams();
    const tabFromUrl = searchParams.get("tab");
    const initialTab = tabFromUrl && (VALID_TABS as readonly string[]).includes(tabFromUrl) ? tabFromUrl : "dashboard";
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        if (tabFromUrl && (VALID_TABS as readonly string[]).includes(tabFromUrl) && tabFromUrl !== activeTab) {
            setActiveTab(tabFromUrl);
        }
    }, [tabFromUrl, activeTab]);

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        const params = new URLSearchParams(window.location.search);
        if (value === "dashboard") {
            params.delete("tab");
        } else {
            params.set("tab", value);
        }
        const qs = params.toString();
        const newUrl = qs ? `/alimtalk?${qs}` : "/alimtalk";
        window.history.replaceState(null, "", newUrl);
    };

    const { data: allPartitionsData } = useSWR("/api/partitions", defaultFetcher);

    const partitions = useMemo(() => {
        const items: Array<{ id: number; name: string; workspaceId: number; workspaceName: string }> = allPartitionsData?.data ?? [];
        const hasMultipleWorkspaces = new Set(items.map((p) => p.workspaceId)).size > 1;
        return items.map((p) => ({
            id: p.id,
            workspaceId: p.workspaceId,
            name: hasMultipleWorkspaces ? `[${p.workspaceName}] ${p.name}` : p.name,
        }));
    }, [allPartitionsData]);

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="알림톡"
                    description="카카오 알림톡을 발송하고 관리합니다."
                />

                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList>
                        <TabsTrigger value="dashboard">대시보드</TabsTrigger>
                        <TabsTrigger value="senders">발신프로필</TabsTrigger>
                        <TabsTrigger value="templates">템플릿</TabsTrigger>
                        <TabsTrigger value="links">연결 관리</TabsTrigger>
                        <TabsTrigger value="logs">발송 이력</TabsTrigger>
                        <TabsTrigger value="settings">설정</TabsTrigger>
                    </TabsList>

                    <TabsContent value="dashboard" className="mt-6">
                        <AlimtalkDashboard onTabChange={handleTabChange} />
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
