"use client";

import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/types";
import type { LeadRecord } from "../types";
import { groupByCompany, groupByDate, isUnansweredOver24h, summarizeLead } from "../utils/lead-fields";
import { InflowBadge } from "./InflowBadge";
import { StatusBadge } from "./StatusBadge";
import { MemberAvatar } from "@/components/sales/ui/MemberAvatar";

const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 영업관리 표의 우리 담당 · 다음 할 일 · 최근 미팅 */
function SalesCells({ record }: { record: LeadRecord }) {
    const s = record.sales;
    const next = s?.nextAction;
    const due = next?.dueAt ? kst(next.dueAt) : null;
    const overdue = due !== null && due <= todayKst();
    return (
        <>
            <td className={cn(CELL, "truncate")}>
                {s?.ownerName ? (
                    <span className="flex items-center gap-1.5">
                        <MemberAvatar name={s.ownerName} className="size-4" />
                        <span className="truncate">{s.ownerName}</span>
                    </span>
                ) : (
                    <span className="text-muted-foreground">-</span>
                )}
            </td>
            <td className={CELL}>
                {next ? (
                    <div className="flex items-start gap-1.5">
                        {due && (
                            <span className={cn("shrink-0 rounded px-1 text-[11px] tabular-nums", overdue ? "bg-rose-100 text-rose-700" : "bg-muted text-muted-foreground")}>
                                {due.slice(5).replace("-", "/")}
                            </span>
                        )}
                        <span className="line-clamp-2">{next.content}</span>
                        {s && s.openActions > 1 && <span className="shrink-0 text-xs text-muted-foreground">+{s.openActions - 1}</span>}
                    </div>
                ) : (
                    <span className="text-muted-foreground">-</span>
                )}
            </td>
            <td className={cn(CELL, "text-muted-foreground")}>
                {s?.lastMeetingAt ? `${kst(s.lastMeetingAt).replaceAll("-", ".")}${s.meetingCount > 1 ? ` (${s.meetingCount}회)` : ""}` : "-"}
            </td>
            <td className={cn(CELL, "text-muted-foreground tabular-nums")}>{kst(String(record.registeredAt)).replaceAll("-", ".")}</td>
        </>
    );
}

interface LeadTableProps {
    records: LeadRecord[];
    fields: FieldDefinition[];
    statusColors?: Record<string, string> | null;
    isLoading: boolean;
    selectedId: number | null;
    onSelect: (record: LeadRecord) => void;
    checkedIds: Set<number>;
    onCheckedChange: (ids: Set<number>) => void;
    /** 페이지 이동 대신 아래에 붙는 버튼(상태별 묶음의 "더보기") */
    footer?: React.ReactNode;
    page?: number;
    totalPages?: number;
    onPageChange?: (page: number) => void;
    /** 상태별 묶음 안에서는 대응상태 칸이 같은 값이라 숨긴다 */
    hideStatus?: boolean;
    /** 상태별 묶음 안에 들어갈 때 — 자기 스크롤 없이 내용 높이만큼 */
    embedded?: boolean;
    /** sales: 요청사항·최근 댓글·유입경로 대신 우리 담당·다음 할 일·최근 미팅 */
    mode?: "lead" | "sales";
}

const HEAD_BASE = "sticky top-0 z-10 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b";
const CELL = "px-3 py-2.5 align-top text-sm";

export function LeadTable({
    records,
    fields,
    statusColors,
    isLoading,
    selectedId,
    onSelect,
    checkedIds,
    onCheckedChange,
    footer,
    page = 1,
    totalPages = 1,
    onPageChange,
    hideStatus,
    embedded,
    mode = "lead",
}: LeadTableProps) {
    const sales = mode === "sales";
    // 영업관리는 기업별, 나머지는 등록일별로 첫 칸을 묶는다
    const groups = sales ? groupByCompany(records) : groupByDate(records);
    const HEAD = HEAD_BASE;
    const colCount = hideStatus ? 9 : 10;
    const allChecked = records.length > 0 && records.every((r) => checkedIds.has(r.id));
    const toggleAll = () => {
        const next = new Set(checkedIds);
        for (const r of records) {
            if (allChecked) next.delete(r.id);
            else next.add(r.id);
        }
        onCheckedChange(next);
    };
    const toggleOne = (id: number) => {
        const next = new Set(checkedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        onCheckedChange(next);
    };

    return (
        <div className={embedded ? "flex flex-col" : "flex min-h-0 flex-1 flex-col"}>
            <div className={embedded ? "overflow-x-auto" : "min-h-0 flex-1 overflow-auto"}>
                <table className="w-full min-w-[1240px] table-fixed border-collapse">
                    <colgroup>
                        <col className={sales ? "w-[160px]" : "w-[104px]"} />
                        <col className="w-[36px]" />
                        {!sales && <col className="w-[180px]" />}
                        <col className={sales ? "w-[150px]" : "w-[100px]"} />
                        <col className="w-[130px]" />
                        <col className="w-[180px]" />
                        {sales ? (
                            <>
                                <col className="w-[120px]" />
                                <col />
                                <col className="w-[110px]" />
                                <col className="w-[96px]" />
                            </>
                        ) : (
                            <>
                                <col />
                                <col className="w-[220px]" />
                                <col className="w-[180px]" />
                            </>
                        )}
                        {!hideStatus && <col className="w-[96px]" />}
                    </colgroup>
                    <thead>
                        <tr>
                            <th className={HEAD}>{sales ? "기업" : "등록일"}</th>
                            <th className={HEAD}>
                                <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="전체 선택" />
                            </th>
                            {!sales && <th className={HEAD}>기업명</th>}
                            <th className={HEAD}>{sales ? "이름" : "담당자"}</th>
                            <th className={HEAD}>연락처</th>
                            <th className={HEAD}>이메일</th>
                            {sales ? (
                                <>
                                    <th className={HEAD}>담당자</th>
                                    <th className={HEAD}>다음 할 일</th>
                                    <th className={HEAD}>최근 미팅</th>
                                    <th className={HEAD}>등록일</th>
                                </>
                            ) : (
                                <>
                                    <th className={HEAD}>요청사항</th>
                                    <th className={HEAD}>최근 댓글</th>
                                    <th className={HEAD}>유입경로</th>
                                </>
                            )}
                            {!hideStatus && <th className={HEAD}>대응상태</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && records.length === 0 &&
                            Array.from({ length: 6 }).map((_, i) => (
                                <tr key={i}>
                                    <td colSpan={colCount} className="px-3 py-2">
                                        <Skeleton className="h-6 w-full" />
                                    </td>
                                </tr>
                            ))}
                        {!isLoading && records.length === 0 && (
                            <tr>
                                <td colSpan={colCount} className="py-16 text-center text-sm text-muted-foreground">
                                    리드가 없습니다.
                                </td>
                            </tr>
                        )}
                        {groups.map((group) =>
                            group.rows.map((record, i) => {
                                const lead = summarizeLead(record, fields);
                                const late = !sales && isUnansweredOver24h(lead.status, record.registeredAt);
                                return (
                                    <tr
                                        key={record.id}
                                        onClick={() => onSelect(record)}
                                        className={cn(
                                            "cursor-pointer border-b last:border-b-0 hover:bg-muted/40",
                                            (selectedId === record.id || checkedIds.has(record.id)) && "bg-accent hover:bg-accent",
                                        )}
                                    >
                                        {i === 0 && (
                                            <td
                                                rowSpan={group.rows.length}
                                                className="border-r bg-muted/30 px-3 py-2.5 align-top text-xs"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="break-words font-medium">{group.date}</div>
                                                <div className="text-muted-foreground">{group.rows.length}{sales ? "명" : "건"}</div>
                                            </td>
                                        )}
                                        <td className={CELL} onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                checked={checkedIds.has(record.id)}
                                                onCheckedChange={() => toggleOne(record.id)}
                                                aria-label="선택"
                                            />
                                        </td>
                                        {!sales && (
                                        <td className={CELL}>
                                            <div className="truncate font-medium">
                                                {lead.company || "-"}
                                            </div>
                                            {late && (
                                                <span className="mt-1 inline-block rounded bg-rose-100 px-1 text-[10px] text-rose-700">
                                                    24h 미응대
                                                </span>
                                            )}
                                        </td>
                                        )}
                                        <td className={cn(CELL, "truncate")}>
                                            {lead.contactName || "-"}
                                            {sales && (record.data as Record<string, unknown>)?.contactTitle ? (
                                                <span className="text-muted-foreground"> / {String((record.data as Record<string, unknown>).contactTitle)}</span>
                                            ) : null}
                                        </td>
                                        <td className={cn(CELL, "truncate")}>{lead.phone || "-"}</td>
                                        <td className={cn(CELL, "truncate")}>{lead.email || "-"}</td>
                                        {sales ? (
                                            <SalesCells record={record} />
                                        ) : (
                                            <>
                                        <td className={CELL}>
                                            <div className="line-clamp-2 text-muted-foreground">{lead.request || "-"}</div>
                                        </td>
                                        <td className={CELL}>
                                            {record.latestMemo ? (
                                                <div className="flex items-start gap-1.5">
                                                    <span className="line-clamp-2 flex-1 text-muted-foreground">{record.latestMemo}</span>
                                                    <Badge variant="secondary" className="shrink-0 gap-0.5 px-1.5 py-0 text-[10px] font-normal">
                                                        <MessageSquare className="h-3 w-3" />
                                                        {record.memoCount ?? 0}
                                                    </Badge>
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </td>
                                        <td className={CELL}>
                                            <InflowBadge inflow={record.inflow} />
                                        </td>
                                            </>
                                        )}
                                        {!hideStatus && (
                                            <td className={CELL}>
                                                {lead.status ? <StatusBadge status={lead.status} colors={statusColors} /> : <span className="text-muted-foreground">-</span>}
                                            </td>
                                        )}
                                    </tr>
                                );
                            }),
                        )}
                    </tbody>
                </table>
            </div>
            {footer}
            {onPageChange && totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 border-t px-4 py-3 text-sm">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                        이전
                    </Button>
                    <span className="text-muted-foreground">
                        {page} / {totalPages}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                        다음
                    </Button>
                </div>
            )}
        </div>
    );
}
