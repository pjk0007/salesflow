import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Layers, ListTree } from "lucide-react";
import { useSession } from "@/contexts/SessionContext";
import WorkspaceSettingsTab from "@/components/settings/WorkspaceSettingsTab";
import FieldManagementTab from "@/components/settings/FieldManagementTab";

export default function WorkspaceSettingsPage() {
    const router = useRouter();
    const { user } = useSession();
    const tabFromQuery = (router.query.tab as string) || "workspace";
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
            { pathname: "/settings/workspace", query: { tab } },
            undefined,
            { shallow: true }
        );
    };

    if (user?.role === "member") return null;

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="워크스페이스 설정"
                    description="워크스페이스와 속성을 관리합니다."
                />

                <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                    <TabsList variant="line" className="w-full justify-start">
                        <TabsTrigger value="workspace">
                            <Layers className="mr-2 h-4 w-4" />
                            워크스페이스 관리
                        </TabsTrigger>
                        <TabsTrigger value="fields">
                            <ListTree className="mr-2 h-4 w-4" />
                            속성 관리
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="workspace" className="mt-6">
                        <WorkspaceSettingsTab />
                    </TabsContent>

                    <TabsContent value="fields" className="mt-6">
                        <FieldManagementTab />
                    </TabsContent>
                </Tabs>
            </PageContainer>
        </WorkspaceLayout>
    );
}
