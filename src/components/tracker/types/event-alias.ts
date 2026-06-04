// 이벤트 별칭 관리 응답 타입

export type EventAliasType = "SECTION_VIEW" | "CLICK" | "CUSTOM";

/**
 * 별칭 관리 카드에서 표시할 한 행.
 * id가 null이면 별칭 미등록 (DB에서 발생한 이벤트만 있는 상태).
 */
export interface EventAliasRow {
    id: number | null;
    eventType: EventAliasType;
    eventName: string;
    label: string | null; // 빈 문자열도 raw로 fallback (UI 책임)
    occurrences: number;
}

export type EventAliasListResponse =
    | { success: true; data: EventAliasRow[] }
    | { success: false; error: string };

// CRUD 응답
export interface EventAliasItem {
    id: number;
    eventType: EventAliasType;
    eventName: string;
    label: string;
}

export type EventAliasMutateResponse =
    | { success: true; data: EventAliasItem }
    | { success: false; error: string };

export type EventAliasDeleteResponse =
    | { success: true }
    | { success: false; error: string };
