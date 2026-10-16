"use client";

import SenderPoolSummary from "@/components/email/sender-profiles/ui/SenderPoolSummary";
import RuleQueueSummary from "@/components/email/sender-profiles/ui/RuleQueueSummary";
import ReplyToSummaryRow from "@/components/email/reply-to/ui/ReplyToSummaryRow";
import { isManualTrigger } from "../utils/templateLinkSender";

interface TemplateLinkSenderSummaryProps {
    triggerType: string;
    ids: number[];
}

export default function TemplateLinkSenderSummary({ triggerType, ids }: TemplateLinkSenderSummaryProps) {
    return isManualTrigger(triggerType) ? (
        <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">발신</span>
            <span className="font-medium">발송 창에서 선택</span>
        </div>
    ) : (
        <>
            <div className="flex justify-between gap-3">
                <span className="shrink-0 text-muted-foreground">발신</span>
                <SenderPoolSummary ids={ids} />
            </div>
            <RuleQueueSummary ids={ids} />
            <ReplyToSummaryRow ids={ids} />
        </>
    );
}
