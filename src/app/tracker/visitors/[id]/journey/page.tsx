import { JourneyPage } from "@/components/journey/ui/JourneyPage";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";

export default async function VisitorJourneyPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <WorkspaceLayout><PageContainer><JourneyPage visitorId={Number(id)} /></PageContainer></WorkspaceLayout>;
}
