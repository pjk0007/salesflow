"use client";

import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { cn } from "@/lib/utils";
import { workspaceLabel } from "@/lib/workspace-label";
import { INLINE_CHEVRON, INLINE_TRIGGER } from "./inline-styles";

/**
 * 사업부 여러 개 고르기 — 드롭다운(입력창과 같은 너비)에서 눌러 켜고 끈다. 하나 이상은 남아 있어야 한다.
 */
export function WorkspaceChips({
    value,
    onChange,
    className,
    inline,
}: {
    value: number[];
    onChange: (ids: number[]) => void;
    className?: string;
    /** 칸 안에서 쓰는 모양 — 테두리 없이, 마우스 올렸을 때만 연회색 (상세 패널) */
    inline?: boolean;
}) {
    const { workspaces } = useWorkspaces();
    const selected = workspaces.filter((w) => value.includes(w.id));
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    inline
                        ? INLINE_TRIGGER
                        : "flex h-9 w-full items-center gap-2 rounded-md border border-border/70 bg-transparent px-3 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    className,
                )}
            >
                <span className={cn("min-w-0 flex-1 truncate", selected.length === 0 && "text-muted-foreground")}>
                    {selected.length ? selected.map((w) => workspaceLabel(w)).join(", ") : "사업부 선택"}
                </span>
                <ChevronDown className={inline ? INLINE_CHEVRON : "h-4 w-4 shrink-0 text-muted-foreground"} />
            </DropdownMenuTrigger>
            {/* 드롭다운도 입력창 너비 그대로 */}
            <DropdownMenuContent align="start" className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
                {workspaces.map((w) => {
                    const on = value.includes(w.id);
                    const last = on && value.length === 1;
                    return (
                        <DropdownMenuItem
                            key={w.id}
                            // 여러 개 고를 수 있게 누르고도 닫히지 않는다. 마지막 하나는 뺄 수 없다
                            onSelect={(e) => {
                                e.preventDefault();
                                if (last) {
                                    toast.error("사업부는 하나 이상 골라야 해요.");
                                    return;
                                }
                                onChange(on ? value.filter((id) => id !== w.id) : [...value, w.id]);
                            }}
                        >
                            <span className="flex-1">{workspaceLabel(w)}</span>
                            {on && <Check className="h-4 w-4 text-primary" />}
                        </DropdownMenuItem>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
