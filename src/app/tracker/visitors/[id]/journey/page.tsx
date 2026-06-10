import { JourneyPage } from "@/components/journey/ui/JourneyPage";

export default async function VisitorJourneyPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <JourneyPage visitorId={Number(id)} />;
}
