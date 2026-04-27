"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useSession } from "@/contexts/SessionContext";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    User,
    LogOut,
    Settings,
    Sun,
    Moon,
    Monitor,
    Home,
    ChevronRight,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileSidebarToggle } from "./sidebar";
import { useBreadcrumbOverrides } from "./breadcrumb-context";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";

const BREADCRUMB_LABELS: Record<string, string> = {
    records: "레코드",
    email: "이메일",
    alimtalk: "알림톡",
    products: "제품",
    "web-forms": "웹 폼",
    logs: "로그",
    users: "사용자",
    settings: "설정",
    profile: "프로필",
    organization: "조직 설정",
    workspace: "워크스페이스",
    billing: "요금제",
    admin: "관리자",
    templates: "템플릿",
    links: "연결",
    "ai-auto": "AI 자동발송",
    new: "새로 만들기",
};

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function HeaderBreadcrumb() {
    const pathname = usePathname();
    const { overrides } = useBreadcrumbOverrides();
    const segments = pathname.split("/").filter(Boolean);

    return (
        <nav className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground ml-2">
            <Home className="h-3.5 w-3.5" />
            {segments.map((segment, i) => {
                const label =
                    overrides[segment] ||
                    BREADCRUMB_LABELS[segment] ||
                    (UUID_RE.test(segment) ? "..." : segment);
                const isLast = i === segments.length - 1;
                return (
                    <span key={segment} className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3" />
                        <span
                            className={cn(
                                isLast
                                    ? "text-foreground font-medium"
                                    : "",
                                "max-w-50 truncate"
                            )}
                        >
                            {label}
                        </span>
                    </span>
                );
            })}
        </nav>
    );
}

function MobileTitle() {
    const pathname = usePathname();
    const { overrides, mobileSubtitle, mobileSheet, mobileSheetOpen, setMobileSheetOpen } =
        useBreadcrumbOverrides();
    const segments = pathname.split("/").filter(Boolean);

    const root = segments[0];
    const rootLabel = root
        ? overrides[root] || BREADCRUMB_LABELS[root] || root
        : "홈";

    const last = segments[segments.length - 1];
    const lastLabel = last
        ? overrides[last] || BREADCRUMB_LABELS[last] || (UUID_RE.test(last) ? "" : last)
        : "";
    const subtitle =
        mobileSubtitle ||
        (segments.length > 1 && lastLabel && lastLabel !== rootLabel ? lastLabel : "");

    const hasSheet = !!mobileSheet;

    const inner = (
        <>
            <span className="font-medium truncate">{rootLabel}</span>
            {subtitle && (
                <>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground truncate">{subtitle}</span>
                </>
            )}
            {hasSheet && (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
        </>
    );

    if (!hasSheet) {
        return (
            <div className="flex sm:hidden items-center gap-1 ml-1 min-w-0 text-sm">
                {inner}
            </div>
        );
    }

    return (
        <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
            <button
                type="button"
                onClick={() => setMobileSheetOpen(true)}
                className="flex sm:hidden items-center gap-1 ml-1 min-w-0 text-sm rounded-md px-2 py-1 hover:bg-muted transition-colors"
            >
                {inner}
            </button>
            <SheetContent side="bottom" className="p-0 h-[85vh] flex flex-col">
                <SheetHeader className="px-4 py-3 border-b">
                    <SheetTitle className="text-base">이동</SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto">{mobileSheet}</div>
            </SheetContent>
        </Sheet>
    );
}

export function Header() {
    const router = useRouter();
    const { user, logout } = useSession();
    const { theme, setTheme } = useTheme();

    return (
        <header className="flex h-14 items-center border-b bg-background px-4 gap-1 min-w-0">
            <MobileSidebarToggle />
            <HeaderBreadcrumb />
            <MobileTitle />
            <div className="flex-1" />
            <div className="flex items-center gap-2">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-2">
                            <User className="h-4 w-4" />
                            <span className="hidden sm:inline">
                                {user?.name || user?.email}
                            </span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
                            {(
                                [
                                    { value: "light", icon: Sun },
                                    { value: "dark", icon: Moon },
                                    { value: "system", icon: Monitor },
                                ] as const
                            ).map((t) => (
                                <Button
                                    key={t.value}
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        "h-8 w-8",
                                        theme === t.value &&
                                            "bg-primary/10 text-primary"
                                    )}
                                    onClick={() => setTheme(t.value)}
                                >
                                    <t.icon className="h-4 w-4" />
                                </Button>
                            ))}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={() => router.push("/settings/profile")}
                        >
                            <User className="mr-2 h-4 w-4" />
                            프로필 설정
                        </DropdownMenuItem>
                        {user?.role !== "member" && (
                            <DropdownMenuItem
                                onClick={() => router.push("/settings/organization")}
                            >
                                <Settings className="mr-2 h-4 w-4" />
                                조직 설정
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={logout}>
                            <LogOut className="mr-2 h-4 w-4" />
                            로그아웃
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
