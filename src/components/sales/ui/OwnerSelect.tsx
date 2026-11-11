"use client";

import { Check, ChevronDown } from "lucide-react";
import { MemberAvatar } from "./MemberAvatar";
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
}: {
    value: string | null;
    onChange: (id: string | null) => void;
    placeholder?: string;
    className?: string;
    /** 줄 전체 너비로 (상세 패널) */
    block?: boolean;
}) {
    const { members, nameOf } = useSalesMembers();
    const name = nameOf(value);
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none hover:bg-accent",
                    block && "w-full",
                    name ? "text-foreground" : "text-muted-foreground",
                    className,
                )}
            >
                {/* 글자 크기에 맞춘 프로필 — 작은 칸은 14px, 상세 패널(block)은 18px */}
                {name ? <MemberAvatar name={name} className={block ? "size-[18px]" : "size-3.5"} /> : null}
                <span className="truncate">{name ?? placeholder}</span>
                <ChevronDown className="ml-auto h-3 w-3 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 min-w-40 overflow-y-auto">
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
