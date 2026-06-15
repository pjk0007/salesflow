"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useTrackerSite } from "../hooks/useTrackerSite";
import { useTrackerVisitors } from "../hooks/useTrackerVisitors";
import { useTrackerStats } from "../hooks/useTrackerStats";
import { useTrackerPages } from "../hooks/useTrackerPages";
import { VisitorListTable } from "./VisitorListTable";
import { VisitorFilterBar, type VisitorFilters } from "./VisitorFilterBar";
import { TrackerSetupForm } from "./TrackerSetupForm";
import { TrackerInstallGuide } from "./TrackerInstallGuide";
import { TrackerSettingsPanel } from "./TrackerSettingsPanel";
import { TrackerPagination } from "./TrackerPagination";
import { OverviewTab } from "./OverviewTab";
import { MarketingTab } from "./MarketingTab";
import { BehaviorTab } from "./BehaviorTab";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, UserCheck, Eye, Settings, BarChart3, Megaphone, Activity } from "lucide-react";
import type { TrackerSite } from "../types";

const WORKSPACE_STORAGE_KEY = "tracker_last_workspace";

const TAB_VALUES = ["overview", "marketing", "behavior", "visitors", "settings"] as const;
type TabValue = typeof TAB_VALUES[number];
function parseTab(v: string | null): TabValue {
    return (TAB_VALUES as readonly string[]).includes(v ?? "") ? (v as TabValue) : "overview";
}

export function VisitorListPage() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const tab = parseTab(searchParams.get("tab"));
    const onTabChange = (next: string) => {
        const sp = new URLSearchParams(searchParams.toString());
        if (next === "overview") sp.delete("tab");
        else sp.set("tab", next);
        router.replace(`${pathname}${sp.toString() ? "?" + sp.toString() : ""}`, { scroll: false });
    };

    const { workspaces } = useWorkspaces();
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(() => {
        if (typeof window === "undefined") return null;
        const saved = localStorage.getItem(WORKSPACE_STORAGE_KEY);
        return saved ? Number(saved) : null;
    });

    const workspaceId = useMemo(() => {
        if (selectedWorkspaceId && workspaces?.some((w) => w.id === selectedWorkspaceId)) {
            return selectedWorkspaceId;
        }
        return workspaces?.[0]?.id ?? null;
    }, [selectedWorkspaceId, workspaces]);

    const changeWorkspace = (id: number) => {
        setSelectedWorkspaceId(id);
        localStorage.setItem(WORKSPACE_STORAGE_KEY, String(id));
    };

    const { site, isLoading: siteLoading, mutate: mutateSite } = useTrackerSite(workspaceId);

    if (!workspaces || workspaces.length === 0) {
        return <p className="text-sm text-muted-foreground">워크스페이스가 없습니다.</p>;
    }

    const workspaceSelector = (
        <Select
            value={workspaceId ? String(workspaceId) : ""}
            onValueChange={(v) => changeWorkspace(Number(v))}
        >
            <SelectTrigger className="w-56">
                <SelectValue placeholder="워크스페이스 선택" />
            </SelectTrigger>
            <SelectContent>
                {workspaces.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    if (siteLoading) {
        return (
            <div className="space-y-4">
                {workspaceSelector}
                <Skeleton className="h-96 w-full rounded-xl" />
            </div>
        );
    }

    if (!site && workspaceId) {
        return (
            <div className="space-y-4">
                {workspaceSelector}
                <TrackerSetupForm workspaceId={workspaceId} onCreated={() => mutateSite()} />
            </div>
        );
    }

    if (!site) {
        return (
            <div className="space-y-4">
                {workspaceSelector}
                <p className="text-sm text-muted-foreground">워크스페이스를 선택해주세요.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">{workspaceSelector}</div>

            <Tabs value={tab} onValueChange={onTabChange}>
                <TabsList variant="line" className="w-full justify-start">
                    <TabsTrigger value="overview">
                        <BarChart3 className="mr-1.5 h-4 w-4" />
                        개요
                    </TabsTrigger>
                    <TabsTrigger value="marketing">
                        <Megaphone className="mr-1.5 h-4 w-4" />
                        마케팅
                    </TabsTrigger>
                    <TabsTrigger value="behavior">
                        <Activity className="mr-1.5 h-4 w-4" />
                        행동
                    </TabsTrigger>
                    <TabsTrigger value="visitors">
                        <Users className="mr-1.5 h-4 w-4" />
                        방문자
                    </TabsTrigger>
                    <TabsTrigger value="settings">
                        <Settings className="mr-1.5 h-4 w-4" />
                        설정
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-4">
                    <OverviewTab siteId={site.id} />
                </TabsContent>

                <TabsContent value="marketing" className="mt-4">
                    <MarketingTab siteId={site.id} />
                </TabsContent>

                <TabsContent value="behavior" className="mt-4">
                    <BehaviorTab siteId={site.id} />
                </TabsContent>

                <TabsContent value="visitors" className="mt-4 space-y-4">
                    <VisitorsBody site={site} />
                </TabsContent>

                <TabsContent value="settings" className="mt-4">
                    <TrackerSettingsPanel site={site} onUpdated={() => mutateSite()} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function VisitorsBody({ site }: { site: TrackerSite }) {
    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [hasRecord, setHasRecord] = useState<"" | "true" | "false">("");
    const [filters, setFilters] = useState<VisitorFilters>({ pagePath: null, channel: null });
    const [page, setPage] = useState(1);

    useEffect(() => {
        setPage(1);
    }, [q, hasRecord, filters.pagePath, filters.channel, site.id]);

    const { items, total, totalPages, isLoading } = useTrackerVisitors({
        siteId: site.id,
        page,
        q: q || undefined,
        hasRecord,
        pagePath: filters.pagePath ?? undefined,
        channel: filters.channel ?? undefined,
    });

    const { stats } = useTrackerStats(site.id, {
        pagePath: filters.pagePath ?? undefined,
        channel: filters.channel ?? undefined,
    });

    const { pages } = useTrackerPages(site.id);

    const isFresh =
        stats != null && stats.totalVisitors === 0 &&
        !q && !hasRecord && !filters.pagePath && !filters.channel;
    if (isFresh) return <TrackerInstallGuide apiKey={site.apiKey} />;

    return (
        <>
            <div className="grid grid-cols-3 gap-3">
                <StatCard icon={<Users className="h-4 w-4" />} label="방문자" value={stats?.totalVisitors ?? 0} />
                <StatCard icon={<UserCheck className="h-4 w-4" />} label="리드 연결" value={stats?.identifiedVisitors ?? 0} />
                <StatCard icon={<Eye className="h-4 w-4" />} label="총 페이지뷰" value={stats?.totalPageviews ?? 0} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="이메일 · 이름 검색"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") setQ(searchInput);
                        }}
                        className="pl-9"
                    />
                </div>
                <Select
                    value={hasRecord || "all"}
                    onValueChange={(v) => setHasRecord(v === "all" ? "" : (v as "true" | "false"))}
                >
                    <SelectTrigger className="w-36">
                        <SelectValue placeholder="필터" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="true">리드 연결됨</SelectItem>
                        <SelectItem value="false">익명</SelectItem>
                    </SelectContent>
                </Select>
                <VisitorFilterBar
                    pages={pages}
                    excludePaths={site.excludePaths ?? []}
                    value={filters}
                    onChange={setFilters}
                />
            </div>

            {isLoading && items.length === 0 ? (
                <Skeleton className="h-96 w-full rounded-xl" />
            ) : (
                <>
                    <p className="text-right text-[11px] text-muted-foreground">
                        * 유입은 첫 방문 기준이며, <span className="font-medium">-</span> 표기는 직접 방문(referrer 없음)을 의미합니다.
                    </p>
                    <VisitorListTable visitors={items} />
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">총 {total.toLocaleString()}명</p>
                        <TrackerPagination page={page} totalPages={totalPages} onChange={setPage} />
                    </div>
                </>
            )}
        </>
    );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
    return (
        <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {icon}
                {label}
            </div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        </div>
    );
}
