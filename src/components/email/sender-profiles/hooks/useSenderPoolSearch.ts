"use client";

import { useState, type ChangeEvent } from "react";
import type { SenderProfile } from "../types";
import { senderPoolSearchSelection } from "../utils/senderPool";

export function useSenderPoolSearch(profiles: SenderProfile[], value: number[], onChange: (ids: number[]) => void) {
    const [query, setQuery] = useState("");
    const selection = senderPoolSearchSelection(profiles, value, query);
    const hasQuery = query.trim().length > 0;
    const picked = new Set(value);
    const selectedCount = profiles.filter(profile => picked.has(profile.id)).length;
    const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value);
    const handleToggleAll = (checked: boolean) => onChange(checked ? selection.selectAllIds : selection.clearAllIds);

    return {
        query,
        handleQueryChange,
        handleToggleAll,
        filteredRest: selection.filteredRest,
        isAllSelected: selection.isAllSelected,
        isSearchVisible: profiles.length > 8,
        isSearchEmpty: selection.isSearchEmpty,
        selectAllLabel: hasQuery ? "검색 결과 전체 선택" : "전체 선택",
        selectAllAriaLabel: hasQuery ? "검색 결과 전체 선택" : "발신 프로필 전체 선택",
        selectedCount,
    };
}
