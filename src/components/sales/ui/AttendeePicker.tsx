"use client";

import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRelatedLeads } from "../hooks/useRelatedLeads";
import { useSalesMembers } from "../hooks/useSalesMembers";

const personLabel = (d: Record<string, unknown>) =>
    [String(d.name ?? d.contactName ?? "").trim(), String(d.contactTitle ?? "").trim()].filter(Boolean).join(" ");

/** 이 기업 담당자 (지금 리드가 맨 앞) — 참석자 이름표와 그 사람의 리드 id */
export function useCompanyPeople(recordId: number, leadData: Record<string, unknown>) {
    const { related } = useRelatedLeads(recordId);
    const people = [
        { label: personLabel(leadData), recordId },
        ...related.map((r) => ({ label: personLabel((r.data ?? {}) as Record<string, unknown>), recordId: r.id })),
    ];
    return people.filter((p, i, a) => p.label && a.findIndex((x) => x.label === p.label) === i);
}

/** 미팅 참석자 — 우리 구성원과 이 기업 담당자 중에서 여러 명 고른다 (저장은 "이름 직책, …" 글자) */
export function AttendeePicker({
    recordId,
    leadData,
    value,
    onChange,
}: {
    recordId: number;
    /** 지금 리드(이 기업 담당자 맨 앞) */
    leadData: Record<string, unknown>;
    value: string[];
    onChange: (v: string[]) => void;
}) {
    const { members } = useSalesMembers();
    const companyPeople = useCompanyPeople(recordId, leadData).map((p) => p.label);
    const toggle = (label: string) => onChange(value.includes(label) ? value.filter((v) => v !== label) : [...value, label]);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="flex h-9 w-full items-center gap-2 rounded-md border border-border/70 bg-transparent px-3 text-left text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <span className={cn("min-w-0 flex-1 truncate", value.length === 0 && "text-muted-foreground")}>
                    {value.length ? value.join(", ") : "참석자 선택"}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">이 기업 담당자</DropdownMenuLabel>
                {companyPeople.map((label) => (
                    <AttendeeItem key={`c:${label}`} label={label} on={value.includes(label)} onToggle={toggle} />
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">우리 구성원</DropdownMenuLabel>
                {members.map((m) => (
                    <AttendeeItem key={`m:${m.id}`} label={m.name} on={value.includes(m.name)} onToggle={toggle} />
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function AttendeeItem({ label, on, onToggle }: { label: string; on: boolean; onToggle: (label: string) => void }) {
    return (
        <DropdownMenuItem
            // 여러 명 고를 수 있게 누르고도 닫히지 않는다
            onSelect={(e) => {
                e.preventDefault();
                onToggle(label);
            }}
        >
            <span className="flex-1">{label}</span>
            {on && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>
    );
}
