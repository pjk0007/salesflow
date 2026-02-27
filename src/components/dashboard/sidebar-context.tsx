import { createContext, useContext, useState, type ReactNode } from "react";

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
    const [open, setOpen] = useState(false);

    return (
        <SidebarContext.Provider
            value={{ open, setOpen, toggle: () => setOpen((prev) => !prev) }}
        >
            {children}
        </SidebarContext.Provider>
    );
}

export function useSidebar() {
    return useContext(SidebarContext);
}
