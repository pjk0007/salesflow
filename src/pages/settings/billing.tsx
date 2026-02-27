import { useEffect } from "react";
import { useRouter } from "next/router";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { PageHeader } from "@/components/common/page-header";
import { useSession } from "@/contexts/SessionContext";
import BillingTab from "@/components/settings/BillingTab";

export default function BillingPage() {
    const router = useRouter();
    const { user } = useSession();

    useEffect(() => {
        if (user && user.role === "member") {
            router.push("/");
        }
    }, [user, router]);

    if (user?.role === "member") return null;

    return (
        <WorkspaceLayout>
            <PageContainer>
                <PageHeader
                    title="요금제"
                    description="구독 플랜과 결제를 관리합니다."
                />
                <BillingTab />
            </PageContainer>
        </WorkspaceLayout>
    );
}
