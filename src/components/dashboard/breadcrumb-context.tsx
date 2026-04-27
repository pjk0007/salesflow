import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";

interface BreadcrumbOverrides {
    [segment: string]: string;
}

interface BreadcrumbContextValue {
    overrides: BreadcrumbOverrides;
    setOverride: (segment: string, label: string) => void;
    mobileSubtitle: string | null;
    setMobileSubtitle: (label: string | null) => void;
    /** 모바일 헤더 타이틀 클릭 시 열리는 시트 콘텐츠. 없으면 타이틀 클릭 비활성. */
    mobileSheet: ReactNode;
    setMobileSheet: (node: ReactNode) => void;
    /** 시트 자체 open 상태 (외부에서 set 가능 — 예: 파티션 선택 시 자동 닫기) */
    mobileSheetOpen: boolean;
    setMobileSheetOpen: (open: boolean) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
    overrides: {},
    setOverride: () => {},
    mobileSubtitle: null,
    setMobileSubtitle: () => {},
    mobileSheet: null,
    setMobileSheet: () => {},
    mobileSheetOpen: false,
    setMobileSheetOpen: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
    const [overrides, setOverrides] = useState<BreadcrumbOverrides>({});
    const [mobileSubtitle, setMobileSubtitleState] = useState<string | null>(null);
    const [mobileSheet, setMobileSheetState] = useState<ReactNode>(null);
    const [mobileSheetOpen, setMobileSheetOpenState] = useState(false);

    const setOverride = useCallback((segment: string, label: string) => {
        setOverrides((prev) => {
            if (prev[segment] === label) return prev;
            return { ...prev, [segment]: label };
        });
    }, []);

    const setMobileSubtitle = useCallback((label: string | null) => setMobileSubtitleState(label), []);
    const setMobileSheet = useCallback((node: ReactNode) => setMobileSheetState(node), []);
    const setMobileSheetOpen = useCallback((open: boolean) => setMobileSheetOpenState(open), []);

    const value = useMemo(
        () => ({
            overrides,
            setOverride,
            mobileSubtitle,
            setMobileSubtitle,
            mobileSheet,
            setMobileSheet,
            mobileSheetOpen,
            setMobileSheetOpen,
        }),
        [overrides, setOverride, mobileSubtitle, setMobileSubtitle, mobileSheet, setMobileSheet, mobileSheetOpen, setMobileSheetOpen],
    );

    return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbOverrides() {
    return useContext(BreadcrumbContext);
}

export function useBreadcrumb(segment: string, label: string) {
    const { setOverride } = useContext(BreadcrumbContext);
    useEffect(() => {
        if (segment && label) {
            setOverride(segment, label);
        }
    }, [segment, label, setOverride]);
}

/**
 * 모바일 헤더에서 현재 페이지 옆에 표시할 서브타이틀 (예: 현재 파티션 이름).
 * 데스크톱 breadcrumb에는 영향 없음.
 */
export function useMobileSubtitle(label: string | null) {
    const { setMobileSubtitle } = useContext(BreadcrumbContext);
    useEffect(() => {
        setMobileSubtitle(label);
        return () => setMobileSubtitle(null);
    }, [label, setMobileSubtitle]);
}

/**
 * 모바일 헤더 타이틀 클릭 시 열리는 시트 콘텐츠 등록.
 * mount 시 등록, unmount 시 자동 해제.
 */
export function useMobileSheet(node: ReactNode) {
    const { setMobileSheet } = useContext(BreadcrumbContext);
    useEffect(() => {
        setMobileSheet(node);
        return () => setMobileSheet(null);
    }, [node, setMobileSheet]);
}
