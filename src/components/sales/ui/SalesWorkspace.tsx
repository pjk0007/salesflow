"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { LeadBoard } from "@/components/leads/ui/LeadBoard";
import { LeadWorkspaceTabs } from "@/components/leads/ui/LeadWorkspaceTabs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { defaultFetcher } from "@/lib/swr-fetcher";

const STORAGE_KEY = "sales_last_workspace";

/**
 * 영업고객 — 윗줄 [전체][사업부…] 탭 + 표.
 * 영업고객이 있는 사업부는 모두에게 보이고, 사람마다 오른쪽 클릭으로 숨기거나 "사업부 추가"로 다른 사업부 탭을 꺼낸다.
 */
export function SalesWorkspace() {
    const [workspaceId, setWorkspaceId] = useState<number | null>(null); // null = 전체
    const { workspaces, isLoading } = useWorkspaces();
    const { data: counts } = useSWR<{ success: boolean; data: Array<{ workspaceId: number; leads: number }> }>("/api/sales/workspaces", defaultFetcher);

    // 마지막으로 본 탭 기억 (브라우저 저장소를 못 쓰면 전체)
    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(STORAGE_KEY));
            // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소 동기화
            if (saved > 0) setWorkspaceId(saved);
        } catch {
            /* 무시 */
        }
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

    const withLeads = useMemo(() => new Set((counts?.data ?? []).filter((c) => c.leads > 0).map((c) => c.workspaceId)), [counts]);
    const tabs = workspaces.filter((w) => withLeads.has(w.id)).map((w) => ({ id: w.id, name: w.name, displayNo: w.displayNo ?? null }));

    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                <LeadWorkspaceTabs
                    value={workspaceId}
                    onChange={select}
                    allTab={{ onSelect: () => select(null) }}
                    prefKey="sales"
                    items={tabs}
                    loading={isLoading || !counts}
                />
                <div className="flex min-h-0 flex-1 flex-col">
                    <LeadBoard key={workspaceId ?? "all"} workspaceId={workspaceId} partitionId={0} fields={[]} mode="sales" />
                </div>
            </div>
        </WorkspaceLayout>
    );
}
