"use client";

import { useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TabPrefs } from "@/lib/db/schema";
import { useLeadWorkspaces } from "../hooks/useLeadWorkspaces";
import { applyOrder, useTabPrefs } from "../hooks/useTabPrefs";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { workspaceLabel } from "@/lib/workspace-label";

export type TabItem = { id: number; name: string; displayNo?: string | null };
export type TabMenuItem = { label: string; onSelect: () => void; destructive?: boolean };

interface LeadWorkspaceTabsProps {
    value: number | null;
    onChange: (workspaceId: number) => void;
    /** 맨 앞에 "전체" 탭 (value null) */
    allTab?: { onSelect: () => void };
    /** 모두에게 기본으로 보이는 사업부 (없으면 source로 정한다) */
    items?: TabItem[];
    /** items를 받는 중 */
    loading?: boolean;
    /** lead: 리드 파티션이 있는 사업, all: 숨기지 않은 모든 사업 */
    source?: "lead" | "all";
    right?: React.ReactNode;
    /**
     * 있으면 사람마다 탭을 끌어 순서를 바꾸고, 오른쪽 클릭으로 숨기고, "사업부 추가"로 다시 꺼낸다 (화면마다 다른 key).
     * 내 설정은 나에게만 보인다.
     */
    prefKey?: string;
    /** "사업부 추가"에서 기본 목록에 없는 사업부를 고를 때 (리드관리: 리드함을 만든다). 없으면 내 탭에만 꺼낸다 */
    onCreate?: (workspaceId: number) => Promise<boolean>;
    /** 오른쪽 클릭 메뉴에 더할 항목 */
    menuItems?: (workspaceId: number) => TabMenuItem[];
    /** "사업부 추가"에서 고를 수 있는 사업부 (없으면 조직의 모든 사업부) */
    pool?: TabItem[];
}

const tabClass = (active: boolean) =>
    cn(
        "flex shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors",
        active ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
    );

const byName = (a: TabItem, b: TabItem) => workspaceLabel(a).localeCompare(workspaceLabel(b), "ko", { numeric: true });
// 끌 때 옆으로만, 탭 줄 안에서만 움직인다 (밖으로 나가면 탭 줄에 스크롤이 생긴다)
const horizontalOnly: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
    let x = transform.x;
    if (draggingNodeRect && containerNodeRect) {
        const min = containerNodeRect.left - draggingNodeRect.left;
        const max = containerNodeRect.right - draggingNodeRect.right;
        x = Math.min(Math.max(x, min), max);
    }
    return { ...transform, x, y: 0 };
};

/** 끌어서 옮길 수 있는 사업부 탭 */
function SortableTab({ ws, active, onClick, onContextMenu }: { ws: TabItem; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ws.id });
    return (
        <button
            ref={setNodeRef}
            type="button"
            onClick={onClick}
            onContextMenu={onContextMenu}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            className={cn(tabClass(active), isDragging && "z-10 bg-background opacity-80")}
            {...attributes}
            {...listeners}
        >
            {workspaceLabel(ws)}
        </button>
    );
}

/** 화면 맨 윗줄 사업(워크스페이스) 탭 — 리드관리·리드통계·리드젠통계·영업고객·레코드·웹 폼 */
export function LeadWorkspaceTabs({ value, onChange, right, source = "lead", allTab, items, loading, prefKey, onCreate, menuItems, pool: poolProp }: LeadWorkspaceTabsProps) {
    const lead = useLeadWorkspaces();
    const all = useWorkspaces();
    const orgPool: TabItem[] = all.workspaces.map((w) => ({ id: w.id, name: w.name, displayNo: w.displayNo ?? null }));
    const pool: TabItem[] = poolProp
        ? poolProp.map((w) => (w.displayNo ? w : { ...w, displayNo: orgPool.find((p) => p.id === w.id)?.displayNo ?? null }))
        : orgPool;
    // 번호 없이 넘어온 사업부는 워크스페이스 설정의 번호를 붙인다 (모든 화면이 같은 "1-디하" 표시)
    const base: TabItem[] = (items ?? (source === "all" ? pool : lead.workspaces)).map((w) =>
        w.displayNo ? w : { ...w, displayNo: orgPool.find((p) => p.id === w.id)?.displayNo ?? null },
    );
    const isLoading = loading || (items ? false : source === "all" ? all.isLoading : lead.isLoading);

    // 내 설정 — 숨긴 탭은 빼고, 꺼낸 탭은 더한다. 끌어서 바꾼 순서(draft)는 저장 전까지 이 화면에만
    const { prefs, loaded, save } = useTabPrefs(prefKey);
    const [draft, setDraft] = useState<number[] | null>(null);
    const [saving, setSaving] = useState(false);
    const hidden = new Set(prefKey ? (prefs.hidden ?? []) : []);
    const added = prefKey ? (prefs.added ?? []) : [];
    const defaultIds = new Set(base.map((w) => w.id));
    const find = (id: number) => base.find((w) => w.id === id) ?? pool.find((w) => w.id === id);
    const shown = [
        ...base.filter((w) => !hidden.has(w.id)),
        ...added.filter((id) => !defaultIds.has(id) && !hidden.has(id)).flatMap((id) => find(id) ?? []),
    ].sort(byName);
    // 숨긴 사업부로 바로 들어온 경우(링크 등) 그 탭만 잠깐 보인다
    if (value !== null && !shown.some((w) => w.id === value) && (defaultIds.has(value) || added.includes(value))) {
        const current = find(value);
        if (current) shown.push(current);
    }
    const workspaces = applyOrder(shown, draft ?? prefs.order);
    const addable = prefKey ? pool.filter((w) => !workspaces.some((s) => s.id === w.id)).sort(byName) : [];
    const dirty = draft !== null;
    // 순서·숨김·꺼낸 탭 중 하나라도 바꿨으면 "초기화"로 기본 탭(모두에게 보이는 목록·이름순)으로 돌린다
    const customized = !!prefKey && ((prefs.order?.length ?? 0) > 0 || hidden.size > 0 || added.length > 0);
    const resetPrefs = async () => {
        setDraft(null);
        const result = await save({ order: [], hidden: [], added: [] });
        report(result);
        if (result.success) toast.success("탭을 기본 설정으로 돌렸어요.");
    };
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const ids = workspaces.map((w) => w.id);
        const next = arrayMove(ids, ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
        const savedIds = applyOrder(shown, prefs.order).map((w) => w.id);
        setDraft(next.join() === savedIds.join() ? null : next);
    };
    const saveOrder = async () => {
        if (!draft) return;
        setSaving(true);
        const result = await save({ order: draft });
        setSaving(false);
        if (!result.success) {
            toast.error(result.error || "순서를 저장하지 못했습니다.");
            return;
        }
        setDraft(null);
        toast.success("탭 순서를 저장했어요.");
    };
    const report = (result: { success: boolean; error?: string }) => {
        if (!result.success) toast.error(result.error || "탭 설정을 저장하지 못했습니다.");
    };

    const hide = async (id: number) => {
        if (id === value) {
            const rest = workspaces.filter((w) => w.id !== id);
            if (allTab) allTab.onSelect();
            else if (rest[0]) onChange(rest[0].id);
        }
        setDraft(null);
        report(await save(defaultIds.has(id) ? { hidden: [...hidden, id] } : { added: added.filter((x) => x !== id) }));
    };
    const add = async (id: number) => {
        const patch: TabPrefs = {};
        if (hidden.has(id)) patch.hidden = [...hidden].filter((x) => x !== id);
        if (!defaultIds.has(id)) {
            if (onCreate) {
                if (!(await onCreate(id))) return;
            } else {
                patch.added = [...added, id];
            }
        }
        if (Object.keys(patch).length > 0) report(await save(patch));
        onChange(id);
    };

    // 고른 사업이 탭에 없으면(레코드에서 쓰던 사업, 숨긴 탭 등) 전체 또는 첫 사업으로
    useEffect(() => {
        if (isLoading || !loaded) return;
        if (allTab && value === null) return;
        if (workspaces.some((w) => w.id === value)) return;
        if (allTab) allTab.onSelect();
        else if (workspaces.length > 0) onChange(workspaces[0].id);
    }, [isLoading, loaded, workspaces, value, onChange, allTab]);

    // 오른쪽 클릭 메뉴 — 누른 자리에 뜬다
    const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null);
    const contextMenu = (id: number) =>
        prefKey || menuItems
            ? (e: React.MouseEvent) => {
                  // 숨길 수도 없고 더한 항목도 없으면(마지막 탭) 빈 메뉴를 띄우지 않는다
                  if (!canHide && !(menuItems?.(id).length ?? 0)) return;
                  e.preventDefault();
                  setMenu({ id, x: e.clientX, y: e.clientY });
              }
            : undefined;
    const canHide = !!prefKey && (!!allTab || workspaces.length > 1);
    const extraItems = menu && menuItems ? menuItems(menu.id) : [];

    const tabs =
        (isLoading && workspaces.length === 0) || !loaded
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="my-2 h-7 w-24" />)
            : prefKey
              ? workspaces.map((ws) => <SortableTab key={ws.id} ws={ws} active={ws.id === value} onClick={() => onChange(ws.id)} onContextMenu={contextMenu(ws.id)} />)
              : workspaces.map((ws) => (
                    <button key={ws.id} type="button" onClick={() => onChange(ws.id)} onContextMenu={contextMenu(ws.id)} className={tabClass(ws.id === value)}>
                        {workspaceLabel(ws)}
                    </button>
                ));

    return (
        // 화면마다 같은 높이로 보이게 높이를 고정한다. 바탕은 페이지 바탕(연한 회색) 그대로
        <div className="flex h-12 shrink-0 items-stretch justify-between gap-3 border-b px-4">
            {/* 탭이 많으면 옆으로 넘겨 보되 스크롤바는 숨긴다 (끌 때 스크롤바가 깜빡이지 않게) */}
            <div className="-mb-px flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {allTab && (
                    <button type="button" onClick={allTab.onSelect} className={tabClass(value === null)}>
                        전체
                    </button>
                )}
                {prefKey ? (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[horizontalOnly]} autoScroll={false} onDragEnd={handleDragEnd}>
                        <SortableContext items={workspaces.map((w) => w.id)} strategy={horizontalListSortingStrategy}>
                            {tabs}
                        </SortableContext>
                    </DndContext>
                ) : (
                    tabs
                )}
            </div>
            {(right || dirty || customized || addable.length > 0) && (
                <div className="flex shrink-0 items-center gap-2">
                    {customized && !dirty && (
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetPrefs}>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            초기화
                        </Button>
                    )}
                    {dirty && (
                        <>
                            <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
                                취소
                            </Button>
                            <Button size="sm" onClick={saveOrder} disabled={saving}>
                                저장
                            </Button>
                        </>
                    )}
                    {right}
                    {addable.length > 0 && loaded && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                    <Plus className="mr-1 h-4 w-4" />
                                    사업부 추가
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-h-72 min-w-44 overflow-y-auto">
                                {addable.map((w) => (
                                    <DropdownMenuItem key={w.id} onClick={() => add(w.id)}>
                                        {workspaceLabel(w)}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            )}
            <DropdownMenu open={!!menu} onOpenChange={(v) => !v && setMenu(null)}>
                <DropdownMenuTrigger asChild>
                    <span className="pointer-events-none fixed size-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-32">
                    {canHide && <DropdownMenuItem onClick={() => menu && hide(menu.id)}>탭 숨기기</DropdownMenuItem>}
                    {extraItems.map((item) => (
                        <DropdownMenuItem key={item.label} variant={item.destructive ? "destructive" : "default"} onClick={item.onSelect}>
                            {item.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
