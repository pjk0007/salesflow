"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LeadRecord } from "@/components/leads/types";
import { linkLeads } from "../api";

const companyOf = (r: LeadRecord) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    return String(d.companyName ?? d.companyname ?? "").trim();
};

/** 고른 리드를 같은 기업으로 묶기 — 어느 기업명을 기준으로 할지 고른다 (직접 입력 가능) */
export function LinkCompanyDialog({
    leads,
    onOpenChange,
    onLinked,
}: {
    leads: LeadRecord[];
    onOpenChange: (open: boolean) => void;
    onLinked: () => void;
}) {
    // 고른 리드들의 기업명 — 많이 나온 순
    const names = useMemo(() => {
        const counts = new Map<string, number>();
        for (const r of leads) {
            const n = companyOf(r);
            if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        return [...counts].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ name: n, count: c }));
    }, [leads]);
    const [choice, setChoice] = useState(names[0]?.name ?? "");
    const [custom, setCustom] = useState("");
    const [saving, setSaving] = useState(false);
    const target = (custom.trim() || choice).trim();

    const submit = async () => {
        if (!target) return;
        setSaving(true);
        try {
            const r = await linkLeads(
                leads.map((l) => l.id),
                target,
            );
            if (!r.success) {
                toast.error(r.error || "묶지 못했습니다.");
                return;
            }
            toast.success(`${r.data?.count ?? leads.length}명을 '${target}'으로 묶었어요.`);
            onOpenChange(false);
            onLinked();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => !saving && onOpenChange(v)}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>같은 기업으로 묶기</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        {leads.length}명을 한 기업으로 묶어요. 어떤 기업명을 기준으로 할까요? 나중에 &apos;묶음에서 빼기&apos;를 하면 원래 이름으로 돌아가요.
                    </p>
                    <ul className="space-y-1">
                        {names.map((n) => (
                            <li key={n.name}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setChoice(n.name);
                                        setCustom("");
                                    }}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60",
                                        !custom && choice === n.name && "bg-accent",
                                    )}
                                >
                                    <span className="flex-1">{n.name}</span>
                                    <span className="text-xs text-muted-foreground">{n.count}명</span>
                                    {!custom && choice === n.name && <Check className="h-4 w-4 text-primary" />}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="다른 기업명으로 직접 입력" />
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button disabled={saving || !target} onClick={submit}>
                        묶기
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
