import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Users, Bot } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import OrgGeneralTab from "@/components/settings/OrgGeneralTab";
import OrgTeamTab from "@/components/settings/OrgTeamTab";
import AiConfigTab from "@/components/settings/AiConfigTab";

export default function OrganizationSettingsPage() {
    const router = useRouter();
    const { user } = useSession();
    const tabFromQuery = (router.query.tab as string) || "general";
    const [activeTab, setActiveTab] = useState(tabFromQuery);

    useEffect(() => {
        if (user && user.role === "member") {
            router.push("/");
        }
    }, [user, router]);

    useEffect(() => {
        const tab = router.query.tab as string;
        if (tab && tab !== activeTab) {
            setActiveTab(tab);
        }
    }, [router.query.tab, activeTab]);

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        router.replace(
            { pathname: "/settings/organization", query: { tab } },
            undefined,
            { shallow: true }
        );
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
