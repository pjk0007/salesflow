"use client";

import { useState, useMemo } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useTrackerSite } from "../hooks/useTrackerSite";
import { useTrackerVisitors } from "../hooks/useTrackerVisitors";
import { VisitorListTable } from "./VisitorListTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Search } from "lucide-react";

export function VisitorListPage() {
    const { workspaces } = useWorkspaces();
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);

    const workspaceId = useMemo(() => {
        return selectedWorkspaceId ?? workspaces?.[0]?.id ?? null;
    }, [selectedWorkspaceId, workspaces]);

    const { site, isLoading: siteLoading } = useTrackerSite(workspaceId);

    const [q, setQ] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [hasRecord, setHasRecord] = useState<"" | "true" | "false">("");

    const { items, isLoading, hasMore, loadMore } = useTrackerVisitors({
        siteId: site?.id ?? null,
        q: q || undefined,
        hasRecord,
    });

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
                <Skeleton className="h-96 w-full" />
            </div>
        );
    }

    if (!site) {
        return (
            <div className="space-y-4">
                {workspaceSelector}
                <div className="rounded border border-dashed p-12 text-center">
                    <p className="text-sm text-muted-foreground mb-4">
                        이 워크스페이스에 트래커가 설정되지 않았습니다.
                    </p>
                    <a
                        href="/settings/workspace?tab=tracker"
                        className="text-sm text-primary hover:underline"
                    >
                        트래커 설정하기 →
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                {workspaceSelector}

                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="이메일/이름 검색"
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
                    <SelectTrigger className="w-40">
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
                <Skeleton className="h-96 w-full" />
            ) : (
                <>
                    <VisitorListTable visitors={items} />
                    {hasMore && (
                        <div className="flex justify-center">
                            <Button variant="outline" onClick={loadMore}>
                                더 보기
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
