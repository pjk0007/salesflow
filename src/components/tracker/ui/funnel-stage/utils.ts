import type { StageMatch } from "../../types/funnel";

export function slugify(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export function defaultMatchFor(type: StageMatch["type"]): StageMatch {
    if (type === "record_field") return { type, field: "", value: "" };
    if (type === "custom_event") return { type, eventName: "" };
    return { type: "page_url", pathPrefix: "" };
}

/**
 * 직접 입력칸을 보일지. 사용자가 "직접 입력"을 고른 상태(manual)는 값이 비어도 유지하고,
 * 저장된 값이 목록에 없으면(기존 사용자 값 재편집) 처음부터 입력칸으로 연다.
 */
export function showsManualEntry(manual: boolean, hasValue: boolean, matchesOption: boolean): boolean {
    return manual || (hasValue && !matchesOption);
}

/** 매칭 값이 비어 저장할 수 없는 단계의 위치(없으면 -1). 라벨이 빈 단계는 저장에서 빠지므로 보지 않는다. */
export function incompleteStageIndex(stages: ReadonlyArray<{ label: string; match: StageMatch }>): number {
    return stages.findIndex((s) => {
        if (!s.label.trim()) return false;
        const m = s.match;
        if (m.type === "record_field") return !m.field.trim() || !m.value.trim();
        if (m.type === "page_url") return !m.pathPrefix.trim();
        return !m.eventName.trim();
    });
}
