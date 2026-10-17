import { Suspense } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { EsignWorkspace } from "@/components/esign/ui/EsignWorkspace";

export default function EsignPage() {
    return <WorkspaceLayout><PageContainer><Suspense fallback={<p className="text-sm text-muted-foreground">전자서명을 불러오고 있습니다.</p>}><EsignWorkspace /></Suspense></PageContainer></WorkspaceLayout>;
}
