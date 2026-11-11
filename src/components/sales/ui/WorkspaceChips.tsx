"use client";

import { Check } from "lucide-react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { cn } from "@/lib/utils";

/** 사업부 여러 개 고르기 — 칩을 눌러 켜고 끈다. locked는 뺄 수 없는 사업부(등록한 사업부) */
export function WorkspaceChips({
    value,
    onChange,
    locked,
}: {
    value: number[];
    onChange: (ids: number[]) => void;
    locked?: number | null;
}) {
    const { workspaces } = useWorkspaces();
    return (
        <div className="flex flex-wrap gap-1.5">
            {workspaces.map((w) => {
                const on = value.includes(w.id) || w.id === locked;
                return (
                    <button
                        key={w.id}
                        type="button"
                        disabled={w.id === locked}
                        onClick={() => onChange(on ? value.filter((id) => id !== w.id) : [...value, w.id])}
                        title={w.id === locked ? "등록한 사업부라 뺄 수 없어요" : undefined}
                        className={cn(
                            "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
                            on ? "border-primary/40 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:bg-muted/60",
                            w.id === locked && "cursor-default",
                        )}
                    >
                        {on && <Check className="h-3 w-3" />}
                        {w.name}
                    </button>
                );
            })}
        </div>
    );
}
