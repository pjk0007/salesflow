"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Users, Bot } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import OrgGeneralTab from "@/components/settings/OrgGeneralTab";
import OrgTeamTab from "@/components/settings/OrgTeamTab";
import AiConfigTab from "@/components/settings/AiConfigTab";

function OrganizationSettingsContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useSession();
    const tabFromQuery = searchParams.get("tab") || "general";
    const [activeTab, setActiveTab] = useState(tabFromQuery);

    useEffect(() => {
        if (user && user.role === "member") {
            router.push("/");
        }
    }, [user, router]);

    useEffect(() => {
        const tab = searchParams.get("tab");
        if (tab && tab !== activeTab) {
            setActiveTab(tab);
        }
    }, [searchParams, activeTab]);

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        router.replace(`/settings/organization?tab=${tab}`);
    };

    if (user?.role === "member") return null;

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="조직 설정"
                    description="조직 정보와 팀을 관리합니다."
                />

                <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                    <TabsList variant="line" className="w-full justify-start">
                        <TabsTrigger value="general">
                            <Building2 className="mr-2 h-4 w-4" />
                            일반
                        </TabsTrigger>
                        <TabsTrigger value="team">
                            <Users className="mr-2 h-4 w-4" />
                            팀멤버
                        </TabsTrigger>
                        <TabsTrigger value="ai">
                            <Bot className="mr-2 h-4 w-4" />
                            AI
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="general" className="mt-6">
                        <OrgGeneralTab />
                    </TabsContent>

                    <TabsContent value="team" className="mt-6">
                        <OrgTeamTab />
                    </TabsContent>

                    <TabsContent value="ai" className="mt-6">
                        <AiConfigTab />
                    </TabsContent>
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}

export default function OrganizationSettingsPage() {
    return (
        <Suspense>
            <OrganizationSettingsContent />
        </Suspense>
    );
}
