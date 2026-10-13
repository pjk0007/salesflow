"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JourneyAlertTable from "@/components/crm/ui/JourneyAlertTable";
import SegmentBuilder from "@/components/crm/ui/SegmentBuilder";

function CrmPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeTab = searchParams.get("tab") || "alerts";
    const setActiveTab = (tab: string) => {
        router.replace(`/crm?tab=${tab}`);
    };

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader title="CRM 관리" />
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="alerts">고객 여정 알림</TabsTrigger>
                        <TabsTrigger value="segments">행동 세그먼트</TabsTrigger>
                    </TabsList>
                    <TabsContent value="alerts" className="mt-6">
                        <JourneyAlertTable />
                    </TabsContent>
                    <TabsContent value="segments" className="mt-6">
                        <SegmentBuilder />
                    </TabsContent>
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}

export default function CrmPage() {
    return (
        <Suspense>
            <CrmPageContent />
        </Suspense>
    );
}
