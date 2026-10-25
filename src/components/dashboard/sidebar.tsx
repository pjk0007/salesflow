"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SendbIcon } from "@/components/SendbLogo";
import { useSidebar } from "./sidebar-context";
import { useSession } from "@/contexts/SessionContext";
import {
    Home,
    Table2,
    MessageSquare,
    Mail,
    Package,
    FileText,
    FileSignature,
    Building2,
    CreditCard,
    Layers,
    PanelLeftClose,
    PanelLeftOpen,
    X,
    History,
    ShieldCheck,
    Activity,
    Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { OrgSwitcher } from "@/components/OrgSwitcher";

const navItems = [
    { href: "/", label: "홈", icon: Home },
    { href: "/records", label: "레코드", icon: Table2 },
    { href: "/inbox", label: "고객 상담", icon: MessageSquare },
    { href: "/customer-crm", label: "고객 관리", icon: Building2 },
    { href: "/alimtalk", label: "알림톡", icon: MessageSquare },
    { href: "/email", label: "이메일", icon: Mail },
    { href: "/email/unsubscribes", label: "수신거부 목록", icon: Ban },
    { href: "/esign", label: "전자서명", icon: FileSignature },
    { href: "/products", label: "제품 관리", icon: Package },
    { href: "/web-forms", label: "웹 폼", icon: FileText },
    { href: "/tracker", label: "트래커", icon: Activity },
    { href: "/logs", label: "발송 이력", icon: History },
];

const bottomNavItems = [
    { href: "/settings/workspace", label: "워크스페이스", icon: Layers },
    { href: "/settings/billing", label: "요금제", icon: CreditCard },
    { href: "/settings/organization", label: "조직 설정", icon: Building2 },
];

function NavLinks({
    collapsed,
    onNavigate,
}: {
    collapsed?: boolean;
    onNavigate?: () => void;
}) {
    const pathname = usePathname();
    const { user } = useSession();

    function renderItem(item: (typeof navItems)[number]) {
        const isActive =
            item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href) && !navItems.some((other) => other.href !== item.href && other.href.startsWith(`${item.href}/`) && pathname.startsWith(other.href));

        const link = (
            <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                    "flex items-center rounded-md text-sm transition-colors relative",
                    collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
                    isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground font-medium"
                )}
            >
                {isActive && !collapsed && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary" />
                )}
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
            </Link>
        );

        if (collapsed) {
            return (
                <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
            );
        }

        return link;
    }

    return (
        <nav className="flex flex-1 flex-col gap-1 p-3">
            {navItems.map(renderItem)}
            {user?.role !== "member" && (
                <>
                    <div className="mt-auto border-t pt-2" />
                    {bottomNavItems.map(renderItem)}
                </>
            )}
            {user?.isSuperAdmin && (
                <>
                    <div className="border-t pt-2" />
                    {renderItem({ href: "/admin", label: "Super Admin", icon: ShieldCheck })}
                </>
            )}
        </nav>
    );
}

export function DesktopSidebar({
    collapsed,
    onToggle,
}: {
    collapsed: boolean;
    onToggle: () => void;
}) {
    return (
        <aside
            className={cn(
                "hidden shrink-0 flex-col overflow-hidden border-r bg-sidebar transition-all duration-200 md:flex",
                collapsed ? "w-16" : "w-60"
            )}
        >
            <div
                className={cn(
                    "flex h-14 items-center border-b",
                    collapsed ? "justify-center px-2" : "px-6"
                )}
            >
                <Link
                    href="/"
                    className="flex items-center gap-2 text-xl font-bold tracking-tight"
                >
                    <SendbIcon className="size-5" />{!collapsed && "Sendb"}
                </Link>
            </div>

            {!collapsed && (
                <div className="border-b px-3 py-2">
                    <OrgSwitcher />
                </div>
            )}

            <div className="flex flex-1 flex-col overflow-y-auto">
                <NavLinks collapsed={collapsed} />
            </div>

            <div
                className={cn(
                    "border-t p-2",
                    collapsed ? "flex justify-center" : "flex justify-end"
                )}
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={onToggle} aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}>
                            {collapsed ? (
                                <PanelLeftOpen className="h-4 w-4" />
                            ) : (
                                <PanelLeftClose className="h-4 w-4" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                        {collapsed ? "사이드바 펼치기" : "사이드바 접기"}
                    </TooltipContent>
                </Tooltip>
            </div>
        </aside>
    );
}

export function MobileSidebar() {
    const { open, setOpen } = useSidebar();
    const opener = useRef<HTMLElement | null>(null);
    useEffect(() => {
        const desktop = window.matchMedia("(min-width: 768px)");
        const closeOnDesktop = () => { if (desktop.matches) setOpen(false); };
        closeOnDesktop();
        desktop.addEventListener("change", closeOnDesktop);
        return () => desktop.removeEventListener("change", closeOnDesktop);
    }, [setOpen]);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="left" showCloseButton={false} aria-describedby={undefined}
                className="w-60 max-w-[85vw] gap-0 bg-sidebar"
                onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
                onCloseAutoFocus={(event) => {
                    if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); }
                }}>
                <SheetTitle className="sr-only">주 메뉴</SheetTitle>
                <div className="flex h-14 items-center justify-between border-b px-6">
                    <Link
                        href="/"
                        className="flex items-center gap-2 text-xl font-bold tracking-tight"
                        onClick={() => setOpen(false)}
                    >
                        <SendbIcon className="size-5" />Sendb
                    </Link>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setOpen(false)}
                        aria-label="메뉴 닫기"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="border-b px-3 py-2">
                    <OrgSwitcher />
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><NavLinks onNavigate={() => setOpen(false)} /></div>
            </SheetContent>
        </Sheet>
    );
}

export function MobileSidebarToggle() {
    const { open, toggle } = useSidebar();

    return (
        <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={toggle}
            aria-label="메뉴 열기"
            aria-expanded={open}
        >
            <PanelLeftOpen className="h-4 w-4" />
        </Button>
    );
}
