"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
    const savePinned = (next: number[]) => {
        setPinned(next);
        try {
            localStorage.setItem(PINNED_KEY, JSON.stringify(next));
        } catch {
            /* 무시 */
        }
    };
    const pin = (id: number) => {
        savePinned([...new Set([...pinned, id])]);
        select(id);
    };
    const unpin = (id: number) => {
        savePinned(pinned.filter((p) => p !== id));
        if (workspaceId === id) select(null);
    };

    // 탭 오른쪽 클릭 메뉴 (누른 자리에 뜬다) + 제거 확인/경고
    const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
    const [removing, setRemoving] = useState<number | null>(null);

    const withLeads = useMemo(() => new Set((counts?.data ?? []).filter((c) => c.leads > 0).map((c) => c.workspaceId)), [counts]);
    // 리드가 있거나, 직접 추가했거나, 지금 보고 있는 사업부만 탭으로
    const tabs = workspaces.filter((w) => withLeads.has(w.id) || pinned.includes(w.id) || w.id === workspaceId);
    const addable = workspaces.filter((w) => !tabs.some((t) => t.id === w.id));
    const leadCount = (id: number) => counts?.data?.find((c) => c.workspaceId === id)?.leads ?? 0;
    const removingWs = workspaces.find((w) => w.id === removing);
    const removingCount = removing ? leadCount(removing) : 0;

    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                <LeadWorkspaceTabs
                    value={workspaceId}
                    onChange={select}
                    allTab={{ onSelect: () => select(null) }}
                    onTabContextMenu={(id, e) => setMenu({ id, x: e.clientX, y: e.clientY })}
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
                <DropdownMenu open={!!menu} onOpenChange={(v) => !v && setMenu(null)}>
                    <DropdownMenuTrigger asChild>
                        <span className="pointer-events-none fixed size-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-32">
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() => {
                                if (menu) setRemoving(menu.id);
                                setMenu(null);
                            }}
                        >
                            탭 제거
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <AlertDialog open={removing !== null} onOpenChange={(v) => !v && setRemoving(null)}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{removingCount > 0 ? "제거할 수 없어요" : "탭을 제거할까요?"}</AlertDialogTitle>
                            <AlertDialogDescription>
                                {removingCount > 0
                                    ? `${removingWs ? workspaceLabel(removingWs) : "이 사업부"}에 영업 리드가 ${removingCount}개 있어요.`
                                    : `${removingWs ? workspaceLabel(removingWs) : "이 사업부"} 탭을 영업리드에서 뺍니다.`}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            {removingCount > 0 ? (
                                <AlertDialogCancel>확인</AlertDialogCancel>
                            ) : (
                                <>
                                    <AlertDialogCancel>취소</AlertDialogCancel>
                                    <AlertDialogAction variant="destructive" onClick={() => removing && unpin(removing)}>
                                        제거
                                    </AlertDialogAction>
                                </>
                            )}
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
                <div className="flex min-h-0 flex-1 flex-col">
                    <LeadBoard key={workspaceId ?? "all"} workspaceId={workspaceId} partitionId={0} fields={[]} mode="sales" />
                </div>
            </div>
        </WorkspaceLayout>
    );
}
