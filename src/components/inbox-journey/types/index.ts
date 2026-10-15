import type { JourneyEvent } from "@/components/journey/types";
export interface ConversationJourney {
    status: "confirmed" | "attributed" | "visitor" | "unlinked";
    record: { id: number; name: string } | null;
    conflict: boolean;
    evidence: "member_or_staff" | "email_link" | "visitor_link" | null;
    ambiguous: boolean;
    events: JourneyEvent[];
    total: number;
    linkedAt: string | null;
}
