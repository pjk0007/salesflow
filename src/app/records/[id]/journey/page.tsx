import { JourneyPage } from "@/components/journey/ui/JourneyPage";

export default async function RecordJourneyPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <JourneyPage recordId={Number(id)} />;
}
