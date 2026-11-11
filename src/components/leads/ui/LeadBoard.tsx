"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Link2Off, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DeleteConfirmDialog from "@/components/records/DeleteConfirmDialog";
import { useRecords } from "@/hooks/useRecords";
import type { FieldDefinition, FilterCondition } from "@/types";
import { deleteLeads, fetchLead, updateLead } from "../api";
import type { LeadRecord } from "../types";
import { STATUS_KEY } from "../utils/lead-fields";
import { useLeadStatuses } from "../hooks/useLeadStatuses";
import { LEAD_STATUS_COLORS } from "@/lib/leads/statuses";
import { CreateLeadDialog } from "./CreateLeadDialog";
import { LeadDetailPanel } from "./LeadDetailPanel";
import { LeadStatusGroup } from "./LeadStatusGroup";
import { LeadTable } from "./LeadTable";
import { useSession } from "@/contexts/SessionContext";
import { BusinessCardButton } from "@/components/sales/ui/BusinessCardButton";
import type { CardFields } from "@/components/sales/types";
import { useSalesLeads, SALES_LEADS_KEY } from "@/components/sales/hooks/useSalesLeads";
import { LinkCompanyDialog } from "@/components/sales/ui/LinkCompanyDialog";
import { unlinkLeads } from "@/components/sales/api";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { workspaceLabel } from "@/lib/workspace-label";

interface LeadBoardProps {
    workspaceId: number | null;
    partitionId: number;
    fields: FieldDefinition[];
    /** sales: 영업관리 — 명함 등록·우리 담당자·미팅 기록이 붙는다 */
    mode?: "lead" | "sales";
}

const ALL = "__all__";
const IMPORTANT = "__important__";
const MINE = "__mine__";

/** 리드 관리 오른쪽 영역 — 상태 탭 · 검색 · 표 · 오른쪽 상세 패널. 파티션이 바뀌면 key로 새로 그린다 */
export function LeadBoard({ workspaceId, partitionId, fields, mode = "lead" }: LeadBoardProps) {
    const sales = mode === "sales";
    const { user } = useSession();
    const [cardPrefill, setCardPrefill] = useState<CardFields | null>(null);
    // 영업관리: 상세 오른쪽에 나란히 여는 연관 리드
    const [secondary, setSecondary] = useState<LeadRecord | null>(null);
    const statusField = fields.find((f) => f.key === STATUS_KEY && f.fieldType === "select");
    // 상태 목록·순서는 워크스페이스 설정(리드 대응상태)을 따른다
    const { enabled: statusOptions } = useLeadStatuses(workspaceId, statusField?.options ?? []);
    const statusColors = useMemo(
        () => ({ ...LEAD_STATUS_COLORS, ...(statusField?.optionColors ?? {}) }),
        [statusField],
    );

    const [tab, setTab] = useState(ALL);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState<LeadRecord | null>(null);
    const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
    const [deleteIds, setDeleteIds] = useState<number[] | null>(null);
    const [createOpen, setCreateOpen] = useState(false);

    // 검색은 입력이 멈춘 뒤 0.3초에
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    // 상태 묶음마다 따로 불러오므로 이 파티션의 목록을 한꺼번에 새로고침
    const { mutate } = useSWRConfig();
    const refreshAll = useCallback(() => {
        const prefix = sales ? SALES_LEADS_KEY : `/api/partitions/${partitionId}/records?`;
        mutate((key) => typeof key === "string" && key.startsWith(prefix));
        // 같은 기업 담당자 목록도 같이 새로
        if (sales) mutate((key) => typeof key === "string" && key.endsWith("/related"));
    }, [mutate, partitionId, sales]);

    // 상태 탭 하나를 볼 때만 쓰는 목록
    const filters = useMemo<FilterCondition[]>(
        () =>
            tab === ALL || tab === IMPORTANT
                ? []
                : tab === MINE
                  ? [{ field: "owner", operator: "equals", value: user?.id ?? "" }]
                  : [{ field: STATUS_KEY, operator: "equals", value: tab }],
        [tab, user?.id],
    );
    const single = useRecords({
        partitionId: sales || tab === ALL ? null : partitionId,
        page,
        pageSize: 50,
        search: search || undefined,
        filters,
        sortField: "registeredAt",
        sortOrder: "desc",
        leadExtras: true,
        important: tab === IMPORTANT,
    });
    // 중요 탭 숫자 칩 — 오늘 연락할 리드 + 연락일 지났는데 댓글 없는 리드
    const importantCount = useRecords({ partitionId: sales ? null : partitionId, page: 1, pageSize: 1, important: true });
    const allCount = useRecords({ partitionId: sales ? null : partitionId, page: 1, pageSize: 1, search: search || undefined });
    // 영업관리: 모든 사업부를 가로지르는 목록 (사업부 탭이면 그 사업부만)
    // 영업관리 '전체'는 사업부별로 묶어 보여줘서 한 번에 넉넉히 불러온다
    const salesAll = sales && workspaceId === null;
    const salesList = useSalesLeads({ enabled: sales, workspaceId, mine: tab === MINE, search, page: salesAll ? 1 : page, pageSize: salesAll ? 200 : 50 });
    const { workspaces: allWorkspaces } = useWorkspaces();
    const list = sales ? salesList : single;

    const changeStatus = (status: string) => changeField(STATUS_KEY, status);

    /** 열린 리드의 칸 하나 바로 저장 (대응상태·우리 담당자 등) */
    const changeField = async (key: string, value: unknown) => {
        if (!selected) return;
        const prev = selected;
        setSelected({ ...prev, data: { ...(prev.data as Record<string, unknown>), [key]: value } });
        const result = await updateLead(prev.id, { [key]: value });
        if (!result.success) {
            setSelected(prev);
            toast.error(result.error || "상태 변경에 실패했습니다.");
            return;
        }
        refreshAll();
    };

    const changeSecondaryField = async (key: string, value: unknown) => {
        if (!secondary) return;
        const prev = secondary;
        setSecondary({ ...prev, data: { ...(prev.data as Record<string, unknown>), [key]: value } });
        const result = await updateLead(prev.id, { [key]: value });
        if (!result.success) {
            setSecondary(prev);
            toast.error(result.error || "저장하지 못했습니다.");
            return;
        }
        refreshAll();
    };

    const [linkOpen, setLinkOpen] = useState(false);
    // 체크한 것 중 같은 기업으로 '묶은' 리드 수 — 이게 있어야 빼기 버튼을 보인다
    const checkedLinked = (list.records as LeadRecord[]).filter(
        (r) => checkedIds.has(r.id) && typeof (r.data as Record<string, unknown>)?.leadGroupId === "string",
    ).length;
    const unlinkChecked = async () => {
        const result = await unlinkLeads([...checkedIds]);
        if (!result.success) {
            toast.error(result.error || "빼지 못했습니다.");
            return;
        }
        const { done = 0, skipped = 0 } = result.data ?? {};
        toast.success(
            skipped > 0
                ? `${done}명을 같은 기업에서 뺐어요. ${skipped}명은 원래 기업명이 같아서 빼지 않았어요 (상세에서 기업명을 바꾸면 떨어져요).`
                : `${done}명을 같은 기업에서 뺐어요. 기업명은 원래대로 돌렸어요.`,
        );
        setCheckedIds(new Set());
        refreshAll();
    };

    const confirmDelete = async () => {
        if (!deleteIds) return;
        const result = await deleteLeads(deleteIds);
        if (!result.success) {
            toast.error(result.error || "삭제에 실패했습니다.");
            return;
        }
        toast.success(`리드 ${deleteIds.length}건을 삭제했습니다.`);
        if (selected && deleteIds.includes(selected.id)) setSelected(null);
        setCheckedIds(new Set());
        setDeleteIds(null);
        refreshAll();
    };

    const tableProps = {
        fields,
        statusColors,
        mode,
        selectedId: selected?.id ?? null,
        onSelect: (r: LeadRecord) => {
            setSelected(r);
            setSecondary(null);
        },
        checkedIds,
        onCheckedChange: setCheckedIds,
    };
    // 켜진 상태들 → 목록에 없는 상태(기타) → 미지정
    const groups: Array<{ key: string; status: string; exclude?: string[] }> = [
        ...statusOptions.map((s) => ({ key: s, status: s })),
        { key: "__other__", status: "", exclude: statusOptions },
        { key: "__none__", status: "" },
    ];

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
                <Tabs
                    value={tab}
                    onValueChange={(v) => {
                        setTab(v);
                        setPage(1);
                        setCheckedIds(new Set());
                    }}
                >
                    <TabsList>
                        <TabsTrigger value={ALL}>전체</TabsTrigger>
                        {sales ? (
                            // 영업관리는 상태 없이 전체 / 내 담당만
                            <TabsTrigger value={MINE}>내 담당</TabsTrigger>
                        ) : (
                            <>
                                <TabsTrigger value={IMPORTANT} className="gap-1.5">
                                    중요
                                    {importantCount.total > 0 && (
                                        <span className="rounded-full bg-rose-600 px-1.5 text-[10px] leading-4 text-white">
                                            {importantCount.total}
                                        </span>
                                    )}
                                </TabsTrigger>
                                {statusOptions.map((s) => (
                                    <TabsTrigger key={s} value={s}>
                                        {s}
                                    </TabsTrigger>
                                ))}
                            </>
                        )}
                    </TabsList>
                </Tabs>
                <div className="flex items-center gap-2">
                    {checkedIds.size > 0 ? (
                        <>
                            <span className="text-sm">{checkedIds.size}건 선택</span>
                            <Button variant="ghost" size="sm" onClick={() => setCheckedIds(new Set())}>
                                선택 해제
                            </Button>
                            {sales && checkedLinked > 0 && (
                                <Button variant="outline" size="sm" onClick={unlinkChecked}>
                                    <Link2Off className="mr-1 h-4 w-4" />
                                    같은 기업에서 빼기
                                </Button>
                            )}
                            {sales && checkedIds.size >= 2 && (
                                <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
                                    <Link2 className="mr-1 h-4 w-4" />
                                    같은 기업으로 묶기
                                </Button>
                            )}
                            <Button variant="destructive" size="sm" onClick={() => setDeleteIds([...checkedIds])}>
                                <Trash2 className="mr-1 h-4 w-4" />
                                삭제
                            </Button>
                        </>
                    ) : (
                        <span className="text-sm text-muted-foreground">
                            전체 {(tab === ALL && !sales ? allCount.total : list.total).toLocaleString()}건
                        </span>
                    )}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="기업명 · 이름 · 연락처 검색"
                            className="h-9 w-64 pl-8"
                        />
                    </div>
                    {sales && (
                        <BusinessCardButton
                            onScanned={(fields) => {
                                setCardPrefill(fields);
                                setCreateOpen(true);
                            }}
                        />
                    )}
                    <Button
                        size="sm"
                        onClick={() => {
                            setCardPrefill(null);
                            setCreateOpen(true);
                        }}
                    >
                        <Plus className="mr-1 h-4 w-4" />
                        {sales ? "직접 추가" : "리드 추가"}
                    </Button>
                </div>
            </div>

            {tab === ALL && !sales ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {groups.map((g) => (
                        <LeadStatusGroup
                            key={g.key}
                            partitionId={partitionId}
                            status={g.status}
                            exclude={g.exclude}
                            search={search}
                            {...tableProps}
                        />
                    ))}
                    {!allCount.isLoading && allCount.total === 0 && (
                        <div className="py-16 text-center text-sm text-muted-foreground">리드가 없습니다.</div>
                    )}
                </div>
            ) : salesAll ? (
                // 영업관리 전체: 사업부별 묶음 (여러 사업부에 걸친 리드는 각 사업부에 다 보인다)
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {allWorkspaces.map((ws) => {
                        const rows = (list.records as LeadRecord[]).filter((r) => {
                            const ids = (r.data as Record<string, unknown>)?.workspaceIds;
                            return r.workspaceId === ws.id || (Array.isArray(ids) && ids.includes(ws.id));
                        });
                        if (rows.length === 0) return null;
                        return (
                            <section key={ws.id} className="border-b">
                                <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm">
                                    <span className="font-medium">{workspaceLabel(ws)}</span>
                                    <span className="text-muted-foreground">{rows.length}명</span>
                                </div>
                                <LeadTable {...tableProps} records={rows} isLoading={false} hideStatus embedded />
                            </section>
                        );
                    })}
                    {!list.isLoading && list.records.length === 0 && (
                        <div className="py-16 text-center text-sm text-muted-foreground">영업 리드가 없습니다.</div>
                    )}
                    {list.total > list.records.length && (
                        <p className="py-3 text-center text-xs text-muted-foreground">
                            최근 {list.records.length}명만 보여요. 사업부 탭이나 검색으로 좁혀 보세요.
                        </p>
                    )}
                </div>
            ) : (
                <LeadTable
                    {...tableProps}
                    records={list.records as LeadRecord[]}
                    isLoading={list.isLoading}
                    page={page}
                    totalPages={list.totalPages}
                    onPageChange={setPage}
                    hideStatus={sales || tab !== IMPORTANT}
                />
            )}

            {selected && (
                <LeadDetailPanel
                    key={selected.id}
                    record={selected}
                    fields={fields}
                    statusOptions={statusOptions}
                    statusColors={statusColors}
                    onClose={() => {
                        setSelected(null);
                        setSecondary(null);
                    }}
                    secondary={secondary}
                    onOpenRelated={setSecondary}
                    onCloseRelated={() => setSecondary(null)}
                    onSecondaryFieldChange={changeSecondaryField}
                    onRecordUpdate={(r) => {
                        setSelected((prev) => (prev && prev.id === r.id ? { ...prev, ...r } : prev));
                        setSecondary((prev) => (prev && prev.id === r.id ? { ...prev, ...r } : prev));
                    }}
                    onStatusChange={changeStatus}
                    onFieldChange={changeField}
                    mode={mode}
                    onDelete={() => setDeleteIds([selected.id])}
                    onCommentAdded={async () => {
                        refreshAll();
                        // 댓글에서 다음 연락일을 정했을 수 있어 열린 리드를 다시 읽는다 (유입경로 등 표 전용 값은 유지)
                        const result = await fetchLead(selected.id);
                        if (result.success && result.data) {
                            setSelected((prev) => (prev && prev.id === result.data!.id ? { ...prev, data: result.data!.data } : prev));
                        }
                    }}
                />
            )}
            <CreateLeadDialog
                key={cardPrefill ? "card" : "manual"}
                open={createOpen}
                onOpenChange={setCreateOpen}
                partitionId={partitionId}
                fields={fields}
                mode={mode}
                prefill={cardPrefill}
                workspaceId={workspaceId}
                onCreated={refreshAll}
            />
            {sales && linkOpen && (
                <LinkCompanyDialog
                    leads={list.records.filter((r) => checkedIds.has(r.id)) as LeadRecord[]}
                    onOpenChange={setLinkOpen}
                    onLinked={() => {
                        setCheckedIds(new Set());
                        refreshAll();
                    }}
                />
            )}
            <DeleteConfirmDialog
                open={deleteIds !== null}
                onOpenChange={(v) => !v && setDeleteIds(null)}
                count={deleteIds?.length ?? 0}
                onConfirm={confirmDelete}
            />
        </div>
    );
}
