import type { FilterCondition } from "@/types";

/**
 * 레코드 목록의 조회 조건과 선택 — 조건이 바뀌면 보이지 않게 된 레코드가 일괄 삭제·발송 대상에 남지 않도록
 * 선택을 비우고(UX-056), 파티션·워크스페이스를 바꾸면 이전 파티션의 조건을 모두 초기화한다(UX-054·055).
 */
export interface RecordListQuery {
    page: number;
    search: string;
    distributionOrder: number | undefined;
    filters: FilterCondition[];
    sortField: string;
    sortOrder: "asc" | "desc";
    selectedIds: Set<number>;
    /** 검색창처럼 자체 입력 상태가 있는 툴바를 다시 그릴 때 쓰는 값 — 조건을 초기화할 때마다 늘어난다 */
    resetCount: number;
}

export const INITIAL_RECORD_LIST_QUERY: RecordListQuery = {
    page: 1,
    search: "",
    distributionOrder: undefined,
    filters: [],
    sortField: "registeredAt",
    sortOrder: "desc",
    selectedIds: new Set(),
    resetCount: 0,
};

export type RecordListQueryAction =
    | { type: "reset" }
    | { type: "search"; search: string }
    | { type: "page"; page: number }
    | { type: "distributionOrder"; order: number | undefined }
    | { type: "filters"; filters: FilterCondition[] }
    | { type: "sort"; field: string; order: "asc" | "desc" }
    | { type: "clearConditions" }
    | { type: "select"; ids: Set<number> }
    | { type: "clearSelection" };

const NO_SELECTION = () => new Set<number>();

export function recordListQueryReducer(state: RecordListQuery, action: RecordListQueryAction): RecordListQuery {
    switch (action.type) {
        case "reset":
            return { ...INITIAL_RECORD_LIST_QUERY, selectedIds: NO_SELECTION(), resetCount: state.resetCount + 1 };
        case "search":
            // 디바운스가 같은 검색어를 다시 보내도 선택·페이지를 건드리지 않는다
            if (action.search === state.search) return state;
            return { ...state, search: action.search, page: 1, selectedIds: NO_SELECTION() };
        case "page":
            if (action.page === state.page) return state;
            return { ...state, page: action.page, selectedIds: NO_SELECTION() };
        case "distributionOrder":
            return { ...state, distributionOrder: action.order, page: 1, selectedIds: NO_SELECTION() };
        case "filters":
            return { ...state, filters: action.filters, page: 1, selectedIds: NO_SELECTION() };
        case "sort":
            return { ...state, sortField: action.field, sortOrder: action.order, page: 1, selectedIds: NO_SELECTION() };
        case "clearConditions":
            return {
                ...state,
                search: "",
                distributionOrder: undefined,
                filters: [],
                page: 1,
                selectedIds: NO_SELECTION(),
                resetCount: state.resetCount + 1,
            };
        case "select":
            return { ...state, selectedIds: action.ids };
        case "clearSelection":
            return state.selectedIds.size === 0 ? state : { ...state, selectedIds: NO_SELECTION() };
    }
}

/** 검색·필터·분배순서 중 하나라도 걸려 있는지 — 빈 목록이 조건 때문인지 구분한다(UX-057) */
export function hasRecordListConditions(q: Pick<RecordListQuery, "search" | "distributionOrder" | "filters">): boolean {
    return !!q.search || q.distributionOrder !== undefined || q.filters.length > 0;
}

/**
 * 표(또는 그룹 하나)의 전체 선택 — 이 표의 행만 더하거나 빼고 다른 그룹에서 고른 선택은 그대로 둔다(UX-056).
 */
export function toggleAllSelection(selected: Set<number>, ids: number[]): Set<number> {
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    const next = new Set(selected);
    for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
    }
    return next;
}

interface PartitionTreeLike {
    folders: { partitions: { id: number }[] }[];
    ungrouped: { id: number }[];
}

/**
 * 저장된(또는 현재) 파티션이 트리에 있으면 그대로, 없으면(삭제됨·다른 조직) 첫 파티션, 파티션이 없으면 null(UX-082).
 * 트리 순서는 화면 왼쪽 메뉴와 같은 미분류 → 폴더 순이다.
 */
export function resolvePartitionSelection(tree: PartitionTreeLike, partitionId: number | null): number | null {
    const all = [...tree.ungrouped, ...tree.folders.flatMap((f) => f.partitions)];
    if (partitionId && all.some((p) => p.id === partitionId)) return partitionId;
    return all[0]?.id ?? null;
}

/** 조직마다 마지막으로 본 워크스페이스·파티션을 따로 기억한다(조직 전환 뒤 남의 파티션 복원 방지, UX-082) */
export function recordsStorageKey(kind: "workspace" | "partition", orgId: string | null | undefined): string {
    const base = kind === "workspace" ? "records_last_workspace" : "records_last_partition";
    return orgId ? `${base}:${orgId}` : base;
}
