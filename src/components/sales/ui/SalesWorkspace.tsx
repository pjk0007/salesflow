"use client";

import { useEffect, useState } from "react";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { LeadBoard } from "@/components/leads/ui/LeadBoard";
import { LeadWorkspaceTabs } from "@/components/leads/ui/LeadWorkspaceTabs";

const STORAGE_KEY = "sales_last_workspace";

/** 영업관리 — 윗줄 [전체][사업부…] 탭 + 표. 파티션 메뉴 없이 모든 사업부의 영업 리드를 본다 */
export function SalesWorkspace() {
    // null = 전체
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);

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

    return (
        <WorkspaceLayout>
            <div className="flex h-[calc(100vh-3.5rem)] flex-col">
                <LeadWorkspaceTabs value={workspaceId} onChange={select} source="all" allTab={{ onSelect: () => select(null) }} />
                <div className="flex min-h-0 flex-1 flex-col">
                    <LeadBoard key={workspaceId ?? "all"} workspaceId={workspaceId} partitionId={0} fields={[]} mode="sales" />
                </div>
            </div>
        </WorkspaceLayout>
    );
}
