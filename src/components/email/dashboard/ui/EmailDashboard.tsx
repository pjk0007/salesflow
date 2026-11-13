"use client";

import SendHealthBanner from "../../send-health/ui/SendHealthBanner";
import SendHealthCard from "../../send-health/ui/SendHealthCard";
import SendQueueOverviewCard from "../../sender-profiles/ui/SendQueueOverviewCard";
import { KeyLeadsCard } from "../../KeyLeadsCard";
import { DashboardLinks } from "./DashboardLinks";

/** 이메일 대시보드 — 발송 상태·대기열·핵심 리드. 발송 통계(지표·추세·비교)는 리드젠통계 화면에서 본다 */
export default function EmailDashboard({ onTabChange }: { onTabChange?: (tab: string) => void }) {
    return <div className="space-y-6">
        <SendHealthBanner />
        <SendQueueOverviewCard />
        <SendHealthCard />
        <KeyLeadsCard />
        <DashboardLinks onTabChange={onTabChange} />
    </div>;
}
