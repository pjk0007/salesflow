"use client";

import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getIconComponent } from "@/components/ui/icon-picker";
import { cn } from "@/lib/utils";
import { useLeadWorkspaces } from "../hooks/useLeadWorkspaces";

interface LeadWorkspaceTabsProps {
    value: number | null;
    onChange: (workspaceId: number) => void;
    /** 탭 옆 숫자 — 리드 관리는 신규 수, 통계는 전체 리드 수 */
    countKind?: "new" | "all";
    right?: React.ReactNode;
}

/** 리드 관리·리드 통계 맨 윗줄 사업(워크스페이스) 탭 — 리드 파티션이 있는 사업만 */
export function LeadWorkspaceTabs({ value, onChange, countKind = "new", right }: LeadWorkspaceTabsProps) {
    const { workspaces, isLoading } = useLeadWorkspaces();

    // 고른 사업에 리드 파티션이 없으면(레코드에서 쓰던 사업 등) 첫 사업으로
    useEffect(() => {
        if (!isLoading && workspaces.length > 0 && !workspaces.some((w) => w.id === value)) {
            onChange(workspaces[0].id);
        }
    }, [isLoading, workspaces, value, onChange]);

    return (
        <div className="flex items-end justify-between gap-3 border-b px-4">
            <div className="-mb-px flex min-w-0 gap-1 overflow-x-auto">
                {isLoading && workspaces.length === 0
                    ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-7 w-24" />)
                    : workspaces.map((ws) => {
                          const Icon = ws.icon ? getIconComponent(ws.icon) : null;
                          const active = ws.id === value;
                          const count = countKind === "new" ? ws.newLeads : ws.leads;
                          return (
                              <button
                                  key={ws.id}
                                  type="button"
                                  onClick={() => onChange(ws.id)}
                                  className={cn(
                                      "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
                                      active
                                          ? "border-primary font-semibold text-foreground"
                                          : "border-transparent text-muted-foreground hover:text-foreground",
                                  )}
                              >
                                  {Icon && <Icon className="h-4 w-4" />}
                                  {ws.name}
                                  {count > 0 && (
                                      <span
                                          className={cn(
                                              "rounded-full px-1.5 text-[10px] leading-4",
                                              countKind === "new" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                                          )}
                                          title={countKind === "new" ? "신규 리드" : "전체 리드"}
                                      >
                                          {count}
                                      </span>
                                  )}
                              </button>
                          );
                      })}
            </div>
            {right && <div className="shrink-0 py-1.5">{right}</div>}
        </div>
    );
}
