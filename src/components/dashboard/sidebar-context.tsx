import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface SidebarContextType {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
    open: false,
    setOpen: () => {},
    toggle: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
    const [open, setOpenState] = useState(false);

    const setOpen = useCallback((v: boolean) => setOpenState(v), []);
    const toggle = useCallback(() => setOpenState((prev) => !prev), []);

    const value = useMemo(
        () => ({ open, setOpen, toggle }),
        [open, setOpen, toggle],
    );

    return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
    return useContext(SidebarContext);
}
