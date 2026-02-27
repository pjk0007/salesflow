import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface BreadcrumbOverrides {
    [segment: string]: string;
}

const BreadcrumbContext = createContext<{
    overrides: BreadcrumbOverrides;
    setOverride: (segment: string, label: string) => void;
}>({
    overrides: {},
    setOverride: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
    const [overrides, setOverrides] = useState<BreadcrumbOverrides>({});

    const setOverride = useCallback((segment: string, label: string) => {
        setOverrides((prev) => {
            if (prev[segment] === label) return prev;
            return { ...prev, [segment]: label };
        });
    }, []);

    return (
        <BreadcrumbContext.Provider value={{ overrides, setOverride }}>
            {children}
        </BreadcrumbContext.Provider>
    );
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
