"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListTree, Sparkles } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import FieldTypeManagementTab from "@/components/settings/FieldTypeManagementTab";
import AutoEnrichTab from "@/components/settings/AutoEnrichTab";

function WorkspaceSettingsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useSession();
    const tabFromQuery = searchParams.get("tab") || "field-types";
    const [activeTab, setActiveTab] = useState(tabFromQuery);

    useEffect(() => {
        if (user && user.role === "member") {
            router.push("/");
        }
    }, [user, router]);

    // 사업부(워크스페이스) 관리는 "사업부 관리" 페이지로 옮겼다
    useEffect(() => {
        if (searchParams.get("tab") === "workspace") router.replace("/settings/business");
    }, [searchParams, router]);

    useEffect(() => {
        const tab = searchParams.get("tab");
        if (tab && tab !== activeTab) {
            setActiveTab(tab);
        }
    }, [searchParams, activeTab]);

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        router.replace(`/settings/workspace?tab=${tab}`);
    };

    if (user?.role === "member") return null;

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="워크스페이스 설정"
                    description="레코드·리드 속성과 자동화를 관리합니다. 사업부는 사업부 관리에서 정해요."
                />

                <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                    <TabsList variant="line" className="w-full justify-start">
                        <TabsTrigger value="field-types">
                            <ListTree className="mr-2 h-4 w-4" />
                            레코드 속성 타입
                        </TabsTrigger>
                        <TabsTrigger value="lead-field-types">
                            <ListTree className="mr-2 h-4 w-4" />
                            리드 속성 타입
                        </TabsTrigger>
<TabsTrigger value="automation">
                            <Sparkles className="mr-2 h-4 w-4" />
                            자동화
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="field-types" className="mt-6">
                        <FieldTypeManagementTab category="cold" />
                    </TabsContent>

                    <TabsContent value="lead-field-types" className="mt-6">
                        <FieldTypeManagementTab key="lead" category="lead" />
                    </TabsContent>

<TabsContent value="automation" className="mt-6">
                        <AutoEnrichTab />
                    </TabsContent>
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}

export default function WorkspaceSettingsPage() {
    return (
        <Suspense>
            <WorkspaceSettingsContent />
        </Suspense>
    );
}
