"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { VisitorDetailPage } from "@/components/tracker/ui/VisitorDetailPage";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TrackerVisitorPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = use(params);
    const visitorPk = Number(id);
    const router = useRouter();

    const handleBack = () => {
        // 직전 페이지가 있으면 그 페이지(보던 목록/필터 유지)로, 없으면 트래커로
        if (window.history.length > 1) {
            router.back();
        } else {
            router.push("/tracker");
        }
    };

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title={
                        <span className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 -ml-1"
                                onClick={handleBack}
                                aria-label="뒤로 가기"
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            방문자 상세
                        </span>
                    }
                />
                {visitorPk ? (
                    <VisitorDetailPage visitorPk={visitorPk} />
                ) : (
                    <p className="text-sm text-muted-foreground">잘못된 ID입니다.</p>
                )}
            </PageContainer>
        </WorkspaceLayout>
    );
}
