"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LeadBoard } from "@/components/leads/ui/LeadBoard";
import { LeadWorkspaceTabs } from "@/components/leads/ui/LeadWorkspaceTabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { workspaceLabel } from "@/lib/workspace-label";

const STORAGE_KEY = "sales_last_workspace";
const PINNED_KEY = "sales_pinned_workspaces";

const readPinned = (): number[] => {
    try {
        const v = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
        return Array.isArray(v) ? v.map(Number).filter((n) => n > 0) : [];
    } catch {
        return [];
    }
};

/**
 * 영업관리 — 윗줄 [전체][사업부…] 탭 + 표.
 * 탭에는 리드가 있는 사업부만 보이고, 오른쪽 "사업부 추가"로 다른 사업부 탭을 꺼내 쓴다 (브라우저에 기억).
 */
export function SalesWorkspace() {
    const [workspaceId, setWorkspaceId] = useState<number | null>(null); // null = 전체
    const [pinned, setPinned] = useState<number[]>([]);
    const { workspaces } = useWorkspaces();
    const { data: counts } = useSWR<{ success: boolean; data: Array<{ workspaceId: number; leads: number }> }>("/api/sales/workspaces", defaultFetcher);

    // 마지막으로 본 탭·추가한 탭 기억 (브라우저 저장소를 못 쓰면 전체)
    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(STORAGE_KEY));
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소 동기화
            if (saved > 0) setWorkspaceId(saved);
        } catch {
            /* 무시 */
        }
        setPinned(readPinned());
    }, []);

    const select = (id: number | null) => {
        setWorkspaceId(id);
        try {
            if (id) localStorage.setItem(STORAGE_KEY, String(id));
            else localStorage.removeItem(STORAGE_KEY);
        } catch {
            /* 무시 */
        }
    };
    const pin = (id: number) => {
        const next = [...new Set([...pinned, id])];
        setPinned(next);
        try {
            localStorage.setItem(PINNED_KEY, JSON.stringify(next));
        } catch {
            /* 무시 */
        }
        select(id);
    };

    const withLeads = useMemo(() => new Set((counts?.data ?? []).filter((c) => c.leads > 0).map((c) => c.workspaceId)), [counts]);
    // 리드가 있거나, 직접 추가했거나, 지금 보고 있는 사업부만 탭으로
    const tabs = workspaces.filter((w) => withLeads.has(w.id) || pinned.includes(w.id) || w.id === workspaceId);
    const addable = workspaces.filter((w) => !tabs.some((t) => t.id === w.id));

    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                <LeadWorkspaceTabs
                    value={workspaceId}
                    onChange={select}
                    allTab={{ onSelect: () => select(null) }}
                    items={tabs.map((w) => ({ id: w.id, name: w.name, displayNo: w.displayNo ?? null }))}
                    right={
                        addable.length > 0 && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm">
                                        <Plus className="mr-1 h-4 w-4" />
                                        사업부 추가
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="max-h-72 min-w-44 overflow-y-auto">
                                    {addable.map((w) => (
                                        <DropdownMenuItem key={w.id} onClick={() => pin(w.id)}>
                                            {workspaceLabel(w)}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )
                    }
                />
                <div className="flex min-h-0 flex-1 flex-col">
                    <LeadBoard key={workspaceId ?? "all"} workspaceId={workspaceId} partitionId={0} fields={[]} mode="sales" />
                </div>
            </div>
        </WorkspaceLayout>
    );
}
