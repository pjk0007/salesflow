// 리드 대응상태 — 화면·서버 공용 (DB 의존 없음)

/** 기본 순서. 워크스페이스 설정에서 켜고 끈다 */
export const LEAD_STATUS_DEFAULTS = ["신규", "부재", "연락 중", "핵심", "테스트", "전환", "종료"] as const;

export const LEAD_STATUS_COLORS: Record<string, string> = {
    신규: "#3b82f6",
    부재: "#9ca3af",
    "연락 중": "#f59e0b",
    연락중: "#f59e0b",
    핵심: "#f97316",
    테스트: "#22c55e",
    전환: "#8b5cf6",
    종료: "#9ca3af",
};

export interface LeadStatusSetting {
    label: string;
    enabled: boolean;
}

/**
 * 워크스페이스 설정이 있으면 그대로, 없으면 기본 순서에서 "테스트"만 끈다.
 * 단 그 사업의 상태 칸 선택지에 이미 "테스트"가 있으면(백오피스랩 등) 켜 둔다.
 */
export function resolveLeadStatusSettings(
    saved: LeadStatusSetting[] | null | undefined,
    fieldOptions: string[] = [],
): LeadStatusSetting[] {
    if (saved && saved.length > 0) {
        // 저장 뒤에 기본 목록에 생긴 값은 꺼진 채로 뒤에 붙인다
        const known = new Set(saved.map((s) => s.label));
        return [...saved, ...LEAD_STATUS_DEFAULTS.filter((l) => !known.has(l)).map((label) => ({ label, enabled: false }))];
    }
    return LEAD_STATUS_DEFAULTS.map((label) => ({
        label,
        enabled: label !== "테스트" || fieldOptions.includes("테스트"),
    }));
}

export function isValidLeadStatusSettings(value: unknown): value is LeadStatusSetting[] {
    return (
        Array.isArray(value) &&
        value.length <= 30 &&
        value.every(
            (v) =>
                v &&
                typeof v === "object" &&
                typeof (v as LeadStatusSetting).label === "string" &&
                (v as LeadStatusSetting).label.trim().length > 0 &&
                (v as LeadStatusSetting).label.length <= 30 &&
                typeof (v as LeadStatusSetting).enabled === "boolean",
        )
    );
}
