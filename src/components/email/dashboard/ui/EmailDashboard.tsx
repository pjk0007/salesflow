"use client";

import SendHealthBanner from "../../send-health/ui/SendHealthBanner";
import SendHealthCard from "../../send-health/ui/SendHealthCard";
import SendQueueOverviewCard from "../../sender-profiles/ui/SendQueueOverviewCard";
import { KeyLeadsCard } from "../../KeyLeadsCard";
import { OpenRateNotice } from "../../opens/ui/OpenRateNotice";
import { useDashboardFilters } from "../hooks/useDashboardFilters";
import { DashboardToolbar } from "./DashboardToolbar";
import { KpiGrid } from "./KpiGrid";
import { TrendPanel } from "./TrendPanel";
import { CompareTable } from "./CompareTable";
import { DashboardLinks } from "./DashboardLinks";
export default function EmailDashboard({ onTabChange }: { onTabChange?: (tab: string) => void }) {
    const filters = useDashboardFilters();
    return <div className="space-y-6">
        <SendHealthBanner />
        <DashboardToolbar filters={filters} />
        <KpiGrid query={filters.query} />
        <OpenRateNotice />
        <TrendPanel query={filters.query} />
        <CompareTable query={filters.query} />
        <SendQueueOverviewCard />
        <SendHealthCard />
        <KeyLeadsCard />
        <DashboardLinks onTabChange={onTabChange} />
    </div>;
}
