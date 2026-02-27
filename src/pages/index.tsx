import Head from "next/head";
import { useSession } from "@/contexts/SessionContext";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import HomeDashboard from "@/components/dashboard/HomeDashboard";
import LandingPage from "@/components/landing/LandingPage";
import { Loader2 } from "lucide-react";

export default function HomePage() {
    const { user, isLoading } = useSession();

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user) {
        return (
            <>
                <Head>
                    <title>SalesFlow - 스마트 영업 관리 플랫폼</title>
                    <meta
                        name="description"
                        content="고객 관리부터 이메일 자동화, AI 도우미까지. 영업의 모든 것을 한 곳에서 관리하세요."
                    />
                    <meta
                        property="og:title"
                        content="SalesFlow - 스마트 영업 관리 플랫폼"
                    />
                    <meta
                        property="og:description"
                        content="고객 관리부터 이메일 자동화, AI 도우미까지."
                    />
                    <meta property="og:type" content="website" />
                </Head>
                <LandingPage />
            </>
        );
    }

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="홈"
                    description="전체 현황을 한눈에 확인하세요."
                />
                <HomeDashboard />
            </PageContainer>
        </WorkspaceLayout>
    );
}
