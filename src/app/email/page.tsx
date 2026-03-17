"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Mail } from "lucide-react";
import EmailDashboard from "@/components/email/EmailDashboard";
import EmailTemplateList from "@/components/email/EmailTemplateList";
import EmailTemplateLinkList from "@/components/email/EmailTemplateLinkList";
import EmailSendLogTable from "@/components/email/EmailSendLogTable";
import EmailConfigForm from "@/components/email/EmailConfigForm";
import EmailCategoryManager from "@/components/email/EmailCategoryManager";
import AutoPersonalizedEmailConfig from "@/components/email/AutoPersonalizedEmailConfig";
import FollowupQueueTable from "@/components/email/FollowupQueueTable";
import { useEmailConfig } from "@/hooks/useEmailConfig";
import { useSenderProfiles } from "@/hooks/useSenderProfiles";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function EmailPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeTab = searchParams.get("tab") || "dashboard";
    const setActiveTab = (tab: string) => {
        router.replace(`/email?tab=${tab}`);
    };

    const { config, isLoading: configLoading } = useEmailConfig();
    const { profiles, isLoading: profilesLoading } = useSenderProfiles();

    const isReady = !!config?.appKey && (profiles?.length ?? 0) > 0;
    const isSetupLoading = configLoading || profilesLoading;

    // 조직 내 모든 파티션 조회
    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);

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
                    title={
                        <span className="flex items-center gap-1.5">
                            이메일
                            <Button
                                variant={activeTab === "settings" ? "secondary" : "ghost"}
                                size="icon"
                                className="size-7"
                                onClick={() => setActiveTab(activeTab === "settings" ? "dashboard" : "settings")}
                            >
                                <Settings className="size-4" />
                            </Button>
                        </span>
                    }
                    description="NHN Cloud Email을 통해 이메일을 발송하고 관리합니다."
                />

                {activeTab === "settings" ? (
                    <div className="mt-6 space-y-6">
                        <EmailConfigForm />
                        <EmailCategoryManager />
                    </div>
                ) : !isSetupLoading && !isReady ? (
                    <div className="mt-6 flex flex-col items-center justify-center py-20">
                        <Card className="max-w-md w-full text-center">
                            <CardHeader>
                                <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
                                    <Mail className="size-6 text-muted-foreground" />
                                </div>
                                <CardTitle>이메일 설정이 필요합니다</CardTitle>
                                <CardDescription>
                                    {!config?.appKey
                                        ? "NHN Cloud Email API 키를 등록해주세요."
                                        : "발신자 프로필을 등록해주세요."}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button onClick={() => setActiveTab("settings")}>
                                    <Settings className="size-4 mr-2" />
                                    설정으로 이동
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                ) : (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList>
                            <TabsTrigger value="dashboard">대시보드</TabsTrigger>
                            <TabsTrigger value="links">연결 관리</TabsTrigger>
                            <TabsTrigger value="templates">템플릿</TabsTrigger>
                            <TabsTrigger value="ai-auto">AI 자동발송</TabsTrigger>
                            <TabsTrigger value="followup-queue">후속 큐</TabsTrigger>
                            <TabsTrigger value="logs">발송 이력</TabsTrigger>
                        </TabsList>

                        <TabsContent value="dashboard" className="mt-6">
                            <EmailDashboard onTabChange={setActiveTab} />
                        </TabsContent>

                        <TabsContent value="links" className="mt-6">
                            <EmailTemplateLinkList partitions={partitions} />
                        </TabsContent>

                        <TabsContent value="templates" className="mt-6">
                            <EmailTemplateList />
                        </TabsContent>

                        <TabsContent value="ai-auto" className="mt-6">
                            <AutoPersonalizedEmailConfig partitions={partitions} />
                        </TabsContent>

                        <TabsContent value="followup-queue" className="mt-6">
                            <FollowupQueueTable />
                        </TabsContent>

                        <TabsContent value="logs" className="mt-6">
                            <EmailSendLogTable />
                        </TabsContent>
                    </Tabs>
                )}
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
