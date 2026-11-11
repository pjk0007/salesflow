"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRecords } from "@/hooks/useRecords";
import { cn } from "@/lib/utils";
import type { FieldDefinition, FilterCondition } from "@/types";
import type { LeadRecord } from "../types";
import { STATUS_KEY } from "../utils/lead-fields";
import { LeadTable } from "./LeadTable";
import { StatusBadge } from "./StatusBadge";

const STEP = 20;

interface LeadStatusGroupProps {
    partitionId: number;
    /** 빈 문자열이면 상태 미지정 묶음 */
    status: string;
    /** 주면 "기타 상태" 묶음 — 이 목록에 없는 상태값 */
    exclude?: string[];
    fields: FieldDefinition[];
    statusColors?: Record<string, string> | null;
    search?: string;
    selectedId: number | null;
    onSelect: (record: LeadRecord) => void;
    checkedIds: Set<number>;
    onCheckedChange: (ids: Set<number>) => void;
}

/** "전체" 탭의 대응상태별 묶음 하나 — 접고 펼 수 있고 20건씩 더 본다 */
export function LeadStatusGroup({ partitionId, status, exclude, search, ...tableProps }: LeadStatusGroupProps) {
    const [open, setOpen] = useState(true);
    const [limit, setLimit] = useState(STEP);
    const filters: FilterCondition[] = exclude
        ? [{ field: STATUS_KEY, operator: "not_in", value: exclude }]
        : status
          ? [{ field: STATUS_KEY, operator: "equals", value: status }]
          : [{ field: STATUS_KEY, operator: "is_empty", value: null }];

    const { records, total, isLoading } = useRecords({
        partitionId,
        page: 1,
        pageSize: limit,
        search: search || undefined,
        filters,
        sortField: "registeredAt",
        sortOrder: "desc",
        leadExtras: true,
    });

    // 비어 있는 묶음은 감춘다 (불러오는 중엔 자리만 비워 둔다)
    if (!isLoading && total === 0) return null;

    return (
        <section className="border-b">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center gap-2 border-b bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
            >
                <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")} />
                {status ? (
                    <StatusBadge status={status} colors={tableProps.statusColors} />
                ) : (
                    <span className="text-sm text-muted-foreground">{exclude ? "기타 상태" : "상태 미지정"}</span>
                )}
                <span className="text-sm text-muted-foreground">{total.toLocaleString()}건</span>
            </button>
            {open && (
                <LeadTable
                    {...tableProps}
                    records={records as LeadRecord[]}
                    isLoading={isLoading}
                    hideStatus={!exclude}
                    embedded
                    footer={
                        records.length < total ? (
                            <div className="border-t p-1.5 text-center">
                                <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + STEP)}>
                                    더보기 ({(total - records.length).toLocaleString()}건 남음)
                                </Button>
                            </div>
                        ) : null
                    }
                />
            )}
        </section>
    );
}
