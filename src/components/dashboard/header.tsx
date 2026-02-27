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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileSidebarToggle } from "./sidebar";
import { useBreadcrumbOverrides } from "./breadcrumb-context";

const BREADCRUMB_LABELS: Record<string, string> = {
    alimtalk: "알림톡",
    settings: "설정",
    profile: "프로필",
    organization: "조직 설정",
    workspace: "워크스페이스",
    billing: "요금제",
    users: "사용자",
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

export function Header() {
    const router = useRouter();
    const { user, logout } = useSession();
    const { theme, setTheme } = useTheme();

    return (
        <header className="flex h-14 items-center border-b bg-background px-4">
            <MobileSidebarToggle />
            <HeaderBreadcrumb />
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
