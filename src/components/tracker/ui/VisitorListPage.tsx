"use client";

import { useState, useMemo, useEffect } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useTrackerSite } from "../hooks/useTrackerSite";
import { useTrackerVisitors } from "../hooks/useTrackerVisitors";
import { useTrackerStats } from "../hooks/useTrackerStats";
import { VisitorListTable } from "./VisitorListTable";
import { TrackerSetupForm } from "./TrackerSetupForm";
import { TrackerInstallGuide } from "./TrackerInstallGuide";
import { TrackerSettingsPanel } from "./TrackerSettingsPanel";
import { TrackerPagination } from "./TrackerPagination";
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
import { Search, Users, UserCheck, Eye, Settings } from "lucide-react";

export function VisitorListPage() {
    const { workspaces } = useWorkspaces();
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);

    const workspaceId = useMemo(() => {
        return selectedWorkspaceId ?? workspaces?.[0]?.id ?? null;
    }, [selectedWorkspaceId, workspaces]);

    const { site, isLoading: siteLoading, mutate: mutateSite } = useTrackerSite(workspaceId);

    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [hasRecord, setHasRecord] = useState<"" | "true" | "false">("");
    const [page, setPage] = useState(1);

    // 검색·필터 변경 시 1페이지로 리셋
    useEffect(() => {
        setPage(1);
    }, [q, hasRecord, site?.id]);

    const { items, total, totalPages, isLoading } = useTrackerVisitors({
        siteId: site?.id ?? null,
        page,
        q: q || undefined,
        hasRecord,
    });

    const { stats } = useTrackerStats(site?.id ?? null);

    if (!workspaces || workspaces.length === 0) {
        return <p className="text-sm text-muted-foreground">워크스페이스가 없습니다.</p>;
    }

    const workspaceSelector = (
        <Select
            value={workspaceId ? String(workspaceId) : ""}
            onValueChange={(v) => setSelectedWorkspaceId(Number(v))}
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

    // 트래커 없음 → 생성 폼
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

    // 통계 전체가 0 + 검색/필터 없음 = 아직 스크립트 설치 전
    const isFresh =
        stats != null && stats.totalVisitors === 0 && !q && !hasRecord;

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">{workspaceSelector}</div>

            <Tabs defaultValue="visitors">
                <TabsList>
                    <TabsTrigger value="visitors">
                        <Users className="mr-1.5 h-4 w-4" />
                        방문자
                    </TabsTrigger>
                    <TabsTrigger value="settings">
                        <Settings className="mr-1.5 h-4 w-4" />
                        설정
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="visitors" className="mt-4 space-y-4">
                    {isFresh ? (
                        <TrackerInstallGuide apiKey={site.apiKey} />
                    ) : (
                        <>
                            {/* 전체 집계 통계 */}
                            <div className="grid grid-cols-3 gap-3">
                                <StatCard
                                    icon={<Users className="h-4 w-4" />}
                                    label="방문자"
                                    value={stats?.totalVisitors ?? 0}
                                />
                                <StatCard
                                    icon={<UserCheck className="h-4 w-4" />}
                                    label="리드 연결"
                                    value={stats?.identifiedVisitors ?? 0}
                                />
                                <StatCard
                                    icon={<Eye className="h-4 w-4" />}
                                    label="총 페이지뷰"
                                    value={stats?.totalPageviews ?? 0}
                                />
                            </div>

                            {/* 검색 + 필터 */}
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
                                    onValueChange={(v) =>
                                        setHasRecord(v === "all" ? "" : (v as "true" | "false"))
                                    }
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
                            </div>

                            {isLoading && items.length === 0 ? (
                                <Skeleton className="h-96 w-full rounded-xl" />
                            ) : (
                                <>
                                    <VisitorListTable visitors={items} />
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm text-muted-foreground">
                                            총 {total.toLocaleString()}명
                                        </p>
                                        <TrackerPagination
                                            page={page}
                                            totalPages={totalPages}
                                            onChange={setPage}
                                        />
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </TabsContent>

                <TabsContent value="settings" className="mt-4">
                    <TrackerSettingsPanel site={site} onUpdated={() => mutateSite()} />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
}) {
    return (
        <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {icon}
                {label}
            </div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">
                {value.toLocaleString()}
            </div>
        </div>
    );
}
