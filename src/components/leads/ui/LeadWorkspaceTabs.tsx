"use client";

import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLeadWorkspaces } from "../hooks/useLeadWorkspaces";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { workspaceLabel } from "@/lib/workspace-label";

interface LeadWorkspaceTabsProps {
    value: number | null;
    onChange: (workspaceId: number) => void;
    /** 맨 앞에 "전체" 탭 (value null) — 영업관리 */
    allTab?: { onSelect: () => void };
    /** 보여줄 사업부를 직접 정한다 (영업관리: 리드 있는 사업부 + 추가한 사업부) */
    items?: Array<{ id: number; name: string; displayNo?: string | null }>;
    right?: React.ReactNode;
    /** 탭 오른쪽 클릭 (영업관리: 추가한 사업부 탭 제거) */
    onTabContextMenu?: (workspaceId: number, e: React.MouseEvent) => void;
    /** lead: 리드 파티션이 있는 사업만, all: 숨기지 않은 모든 사업 (영업관리) */
    source?: "lead" | "all";
}

/** 리드 관리·리드 통계 맨 윗줄 사업(워크스페이스) 탭 — 리드 파티션이 있는 사업만 */
export function LeadWorkspaceTabs({ value, onChange, right, source = "lead", allTab, items, onTabContextMenu }: LeadWorkspaceTabsProps) {
    const lead = useLeadWorkspaces();
    const all = useWorkspaces();
    const workspaces =
        items ?? (source === "all" ? all.workspaces.map((w) => ({ id: w.id, name: w.name, displayNo: w.displayNo ?? null })) : lead.workspaces);
    const isLoading = source === "all" ? all.isLoading : lead.isLoading;

    // 고른 사업에 리드 파티션이 없으면(레코드에서 쓰던 사업 등) 첫 사업으로
    useEffect(() => {
        if (allTab && value === null) return;
        if (!isLoading && workspaces.length > 0 && !workspaces.some((w) => w.id === value)) {
            onChange(workspaces[0].id);
        }
    }, [isLoading, workspaces, value, onChange, allTab]);

    return (
        // 리드관리·리드통계가 같은 높이로 보이게 높이를 고정한다. 바탕은 페이지 바탕(연한 회색) 그대로
        <div className="flex h-12 shrink-0 items-stretch justify-between gap-3 border-b px-4">
            <div className="-mb-px flex min-w-0 gap-1 overflow-x-auto">
                {allTab && (
                    <button
                        type="button"
                        onClick={allTab.onSelect}
                        className={cn(
                            "flex shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                            value === null ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        전체
                    </button>
                )}
                {isLoading && workspaces.length === 0
                    ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-7 w-24" />)
                    : workspaces.map((ws) => {
                          const active = ws.id === value;
                          return (
                              <button
                                  key={ws.id}
                                  type="button"
                                  onClick={() => onChange(ws.id)}
                                  onContextMenu={
                                      onTabContextMenu
                                          ? (e) => {
                                                e.preventDefault();
                                                onTabContextMenu(ws.id, e);
                                            }
                                          : undefined
                                  }
                                  className={cn(
                                      "flex shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
                                      active
                                          ? "border-primary font-semibold text-foreground"
                                          : "border-transparent text-muted-foreground hover:text-foreground",
                                  )}
                              >
                                  {workspaceLabel(ws)}
                              </button>
                          );
                      })}
            </div>
            {right && <div className="flex shrink-0 items-center">{right}</div>}
        </div>
    );
}
