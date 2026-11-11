"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { companyKey } from "@/components/leads/utils/lead-fields";
import { useSalesCompanies, type SalesCompany } from "../hooks/useSalesCompanies";

/** 기업명 — 직접 입력하거나, 고른 사업부의 기존 기업에서 고른다 (고르면 onPick으로 주소 등을 채운다) */
export function CompanyCombobox({
    value,
    onChange,
    onPick,
    workspaceIds,
}: {
    value: string;
    onChange: (v: string) => void;
    onPick: (company: SalesCompany) => void;
    workspaceIds: number[];
}) {
    const { companies } = useSalesCompanies();
    const [open, setOpen] = useState(false);
    const matches = useMemo(() => {
        const q = companyKey(value);
        return companies
            .filter((c) => workspaceIds.length === 0 || c.workspaceIds.some((w) => workspaceIds.includes(w)))
            .filter((c) => !q || companyKey(c.name).includes(q))
            .slice(0, 50);
    }, [companies, workspaceIds, value]);
    const show = open && matches.length > 0;

    return (
        <Popover open={show} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <Input
                    value={value}
                    onChange={(e) => {
                        onChange(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onClick={() => setOpen(true)}
                    onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
                    placeholder="입력하거나 선택"
                />
            </PopoverAnchor>
            <PopoverContent
                align="start"
                className="max-h-72 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-1 scrollbar-thin"
                onOpenAutoFocus={(e) => e.preventDefault()}
                onInteractOutside={(e) => {
                    // 입력창을 다시 누른 건 바깥 클릭이 아니다
                    if ((e.target as HTMLElement)?.closest?.("input") === document.activeElement) e.preventDefault();
                }}
            >
                {matches.map((c) => (
                    <button
                        key={c.name}
                        type="button"
                        onClick={() => {
                            onPick(c);
                            setOpen(false);
                        }}
                        className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                        <span className="flex w-full items-center gap-2">
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{c.count}명</span>
                        </span>
                        {c.address && <span className="w-full truncate text-xs text-muted-foreground">{c.address}</span>}
                    </button>
                ))}
            </PopoverContent>
        </Popover>
    );
}
