"use client";

import { Check, ChevronDown } from "lucide-react";
import { MemberAvatar } from "./MemberAvatar";
import { INLINE_CHEVRON, INLINE_TRIGGER } from "./inline-styles";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSalesMembers } from "../hooks/useSalesMembers";

/** 담당자 고르기 — 작은 버튼 + 디자인된 드롭다운 */
export function OwnerSelect({
    value,
    onChange,
    placeholder = "담당자",
    className,
    block,
    field,
}: {
    value: string | null;
    onChange: (id: string | null) => void;
    placeholder?: string;
    className?: string;
    /** 줄 전체 너비로 (상세 패널) */
    block?: boolean;
    /** 입력창 모양 (테두리 있는 h-9) — 추가 창 등 다른 입력칸과 나란히 놓일 때 */
    field?: boolean;
}) {
    const { members, nameOf } = useSalesMembers();
    const name = nameOf(value);
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    // block(상세 패널)은 사업부 등 다른 칸과 같은 공통 모양, 작은 칸은 글자만 작게
                    field
                        ? "flex h-9 w-full items-center gap-2 rounded-md border border-border/70 bg-transparent px-3 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        : block
                          ? INLINE_TRIGGER
                          : "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none hover:bg-muted",
                    name ? "text-foreground" : "text-muted-foreground",
                    className,
                )}
            >
                {/* 글자 크기에 맞춘 프로필 — 작은 칸은 14px, 상세 패널(block)은 18px */}
                {name ? <MemberAvatar name={name} className={field ? "size-4" : block ? "size-[18px]" : "size-3.5"} /> : null}
                <span className={cn("truncate", field && "min-w-0 flex-1")}>{name ?? placeholder}</span>
                <ChevronDown className={field ? "h-4 w-4 shrink-0 text-muted-foreground" : block ? INLINE_CHEVRON : "ml-auto h-3 w-3 shrink-0"} />
            </DropdownMenuTrigger>
            {/* 상세 패널(block)에서는 드롭다운도 칸 너비 그대로 */}
            <DropdownMenuContent
                align="start"
                className={cn("max-h-72 overflow-y-auto", block || field ? "w-[var(--radix-dropdown-menu-trigger-width)]" : "min-w-40")}
            >
                {members.map((m) => (
                    <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)}>
                        <MemberAvatar name={m.name} className="size-4" />
                        {m.name}
                        {value === m.id && <Check className="ml-auto h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
                {value && (
                    <DropdownMenuItem className="text-muted-foreground" onClick={() => onChange(null)}>
                        담당자 비우기
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
