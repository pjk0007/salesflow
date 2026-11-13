"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { useSession } from "@/contexts/SessionContext";
import WorkspaceSettingsTab from "@/components/settings/WorkspaceSettingsTab";

/** 사업부 관리 — 사업부(워크스페이스) 추가·이름·번호. 모든 화면의 사업부 탭이 여기 목록을 쓴다 */
export default function BusinessSettingsPage() {
    const router = useRouter();
    const { user } = useSession();
    useEffect(() => {
        if (user?.role === "member") router.push("/");
    }, [user, router]);
    if (user?.role === "member") return null;
    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader title="사업부 관리" description="사업부를 추가하고 이름·번호를 정합니다. 모든 메뉴의 사업부 탭에 같은 이름과 번호로 보여요." />
                <WorkspaceSettingsTab />
            </PageContainer>
        </WorkspaceLayout>
    );
}
