"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tags, Plus, Pencil, Trash2, Copy, Check, Search } from "lucide-react";
import { toast } from "sonner";
import { useEventAliases, deleteEventAlias } from "../hooks/useEventAliases";
import { EventAliasEditorDialog } from "./EventAliasEditorDialog";
import type { EventAliasRow, EventAliasType } from "../types/event-alias";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { TrackerPagination } from "./TrackerPagination";

interface Props {
    siteId: number;
}

function CopyBtn({ text, title }: { text: string; title?: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            title={title}
            className="ml-1.5 inline-flex align-middle text-muted-foreground hover:text-foreground"
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
        >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
        </button>
    );
}

const FILTERS: Array<{ value: "all" | EventAliasType; label: string }> = [
    { value: "all", label: "전체" },
    { value: "SECTION_VIEW", label: "섹션 노출" },
    { value: "CLICK", label: "클릭" },
    { value: "CUSTOM", label: "이벤트 코드" },
];

/**
 * 트래커 설정 탭 — 이벤트 이름 별칭 관리.
 * 사이트에서 실제 발생한 SECTION_VIEW/CLICK 이벤트 목록을 표로 보여주고
 * 운영자가 한글 라벨을 매핑할 수 있게 한다.
 */
export function EventAliasesCard({ siteId }: Props) {
    const { confirm, confirmationDialog } = useAsyncConfirm();
    const [filter, setFilter] = useState<"all" | EventAliasType>("all");
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const { data: filtered, total, page: servedPage, totalPages, isLoading, error, mutate } = useEventAliases(siteId, {
        type: filter === "all" ? null : filter,
        q: search,
        page,
    });
    const [editorOpen, setEditorOpen] = useState(false);
    const [initial, setInitial] = useState<EventAliasRow | null>(null);
    const hasFilter = filter !== "all" || search !== "";

    const changeFilter = (value: "all" | EventAliasType) => {
        setFilter(value);
        setPage(1);
    };
    const submitSearch = () => {
        setSearch(searchInput.trim());
        setPage(1);
    };
    const resetFilters = () => {
        setFilter("all");
        setSearch("");
        setSearchInput("");
        setPage(1);
    };

    const openCreate = () => {
        setInitial(null);
        setEditorOpen(true);
    };
    const openPrefill = (row: EventAliasRow) => {
        // 신규 등록인데 type/name 미리 채움
        setInitial({ ...row, id: null });
        setEditorOpen(true);
    };
    const openEdit = (row: EventAliasRow) => {
        setInitial(row);
        setEditorOpen(true);
    };
    const handleDelete = async (row: EventAliasRow) => {
        if (!row.id) return;
        const id = row.id;
        confirm({
            title: "이벤트 별칭 삭제",
            description: `"${row.label || row.eventName}" 별칭을 삭제하시겠습니까?\n분석 화면에서는 raw 이름으로 표시됩니다.`,
            onConfirm: async () => {
                await deleteEventAlias(id);
                toast.success("삭제되었습니다.");
                mutate();
            },
        });
    };

    return (
        <Card>
            {confirmationDialog}
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                    <span className="inline-flex items-center gap-2">
                        <Tags className="h-4 w-4 text-muted-foreground" />
                        이벤트 라벨
                    </span>
                    <Button size="sm" variant="outline" onClick={openCreate}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        별칭 등록
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    페이지에 박은 raw 이름(예: <code className="rounded bg-muted px-1 text-[11px]">hero</code>)에
                    한글 라벨을 매핑하면 마케팅 탭의 페이지 인게이지먼트에서 라벨로 표시됩니다.
                </p>

                <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-[11px]">
                    {FILTERS.map((f) => (
                        <button
                            key={f.value}
                            type="button"
                            aria-pressed={filter === f.value}
                            onClick={() => changeFilter(f.value)}
                            className={
                                filter === f.value
                                    ? "rounded bg-background px-2 py-0.5 font-medium shadow-sm"
                                    : "rounded px-2 py-0.5 text-muted-foreground hover:text-foreground"
                            }
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                    <div className="flex gap-1">
                        <Input
                            aria-label="이벤트 이름·라벨 검색"
                            placeholder="이름·라벨 검색"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
                            className="h-7 w-44 text-xs"
                        />
                        <Button size="icon" variant="outline" className="h-7 w-7" aria-label="검색" onClick={submitSearch}>
                            <Search className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>

                {error && filtered.length === 0 ? (
                    <QueryErrorState error={error} onRetry={() => mutate()} />
                ) : isLoading && filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">불러오는 중...</p>
                ) : filtered.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-[12px] text-muted-foreground">
                        {hasFilter ? (
                            <>
                                조건에 맞는 이벤트가 없습니다.{" "}
                                <button type="button" className="underline" onClick={resetFilters}>필터 초기화</button>
                            </>
                        ) : (
                            <>
                                아직 추적된 이벤트가 없습니다. 페이지에 <code className="font-mono">data-track-section</code> /{" "}
                                <code className="font-mono">data-track-click</code> 속성을 박은 후 방문이 발생하면 여기에 표시됩니다.
                            </>
                        )}
                    </div>
                ) : (
                    <>
                    <div className="rounded-md border text-xs">
                        <table className="w-full">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="px-2 py-1.5 text-left font-medium">타입</th>
                                    <th className="px-2 py-1.5 text-left font-medium">이름</th>
                                    <th className="px-2 py-1.5 text-left font-medium">라벨</th>
                                    <th className="px-2 py-1.5 text-right font-medium">발생</th>
                                    <th className="px-2 py-1.5 text-right font-medium">액션</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => {
                                    const hasLabel = !!(r.label && r.label.trim());
                                    return (
                                        <tr key={`${r.eventType}-${r.eventName}`} className="border-t">
                                            <td className="px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                                                {r.eventType === "SECTION_VIEW" ? "섹션" : r.eventType === "CLICK" ? "클릭" : "이벤트"}
                                            </td>
                                            <td className="px-2 py-1.5 font-mono">
                                                {r.eventName}
                                                {r.eventType === "CUSTOM" && (
                                                    <CopyBtn text={`sendb.track('${r.eventName}')`} title="sendb.track 코드 복사" />
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5">
                                                {hasLabel ? (
                                                    <span>{r.label}</span>
                                                ) : (
                                                    <span className="text-muted-foreground">(미설정)</span>
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                                {r.occurrences.toLocaleString()}
                                            </td>
                                            <td className="px-2 py-1.5 text-right">
                                                {r.id ? (
                                                    <div className="inline-flex gap-1">
                                                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)} title="편집">
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => handleDelete(r)}
                                                            className="text-rose-600 hover:text-rose-700"
                                                            title="삭제"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button size="sm" variant="outline" onClick={() => openPrefill(r)}>
                                                        <Plus className="mr-1 h-3 w-3" />
                                                        추가
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">총 {total.toLocaleString()}건</p>
                        {/* 요청 page가 마지막을 넘으면(삭제로 마지막 페이지가 빈 경우 등) 서버가 당겨 준 page를 기준으로 표시·이동한다 */}
                        <TrackerPagination page={servedPage} totalPages={totalPages} onChange={setPage} />
                    </div>
                    </>
                )}
            </CardContent>
            <EventAliasEditorDialog
                open={editorOpen}
                onOpenChange={setEditorOpen}
                siteId={siteId}
                initial={initial}
                onSaved={() => mutate()}
            />
        </Card>
    );
}
