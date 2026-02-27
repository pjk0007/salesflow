import { useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "./sidebar-context";
import { BreadcrumbProvider } from "./breadcrumb-context";
import { DesktopSidebar, MobileSidebar } from "./sidebar";
import { Header } from "./header";

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <SidebarProvider>
            <BreadcrumbProvider>
                <TooltipProvider>
                    <div className="flex h-screen">
                        <DesktopSidebar
                            collapsed={collapsed}
                            onToggle={() => setCollapsed((prev) => !prev)}
                        />
                        <MobileSidebar />
                        <div className="flex flex-1 flex-col overflow-hidden">
                            <Header />
                            <main className="flex-1 overflow-auto bg-muted/30">
                                {children}
                            </main>
                        </div>
                    </div>
                </TooltipProvider>
            </BreadcrumbProvider>
        </SidebarProvider>
    );
}
