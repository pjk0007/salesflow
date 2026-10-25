import { useCallback, useMemo, useReducer } from "react";
import type { FilterCondition } from "@/types";
import {
    INITIAL_RECORD_LIST_QUERY,
    hasRecordListConditions,
    recordListQueryReducer,
} from "../utils/list-query";

/** 레코드 목록 화면의 검색·필터·분배·정렬·페이지·선택 상태 — 전이 규칙은 utils/list-query.ts */
export function useRecordListQuery() {
    const [query, dispatch] = useReducer(recordListQueryReducer, INITIAL_RECORD_LIST_QUERY);

    const reset = useCallback(() => dispatch({ type: "reset" }), []);
    const setSearch = useCallback((search: string) => dispatch({ type: "search", search }), []);
    const setPage = useCallback((page: number) => dispatch({ type: "page", page }), []);
    const setDistributionOrder = useCallback(
        (order: number | undefined) => dispatch({ type: "distributionOrder", order }),
        [],
    );
    const setFilters = useCallback((filters: FilterCondition[]) => dispatch({ type: "filters", filters }), []);
    const setSort = useCallback(
        (field: string, order: "asc" | "desc") => dispatch({ type: "sort", field, order }),
        [],
    );
    const clearConditions = useCallback(() => dispatch({ type: "clearConditions" }), []);
    const setSelectedIds = useCallback((ids: Set<number>) => dispatch({ type: "select", ids }), []);
    const clearSelection = useCallback(() => dispatch({ type: "clearSelection" }), []);

    const hasConditions = useMemo(() => hasRecordListConditions(query), [query]);

    return {
        ...query,
        hasConditions,
        reset,
        setSearch,
        setPage,
        setDistributionOrder,
        setFilters,
        setSort,
        clearConditions,
        setSelectedIds,
        clearSelection,
    };
}
