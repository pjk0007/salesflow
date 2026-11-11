"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { companyKey } from "@/components/leads/utils/lead-fields";
import { unlinkLead } from "../api";

/** 고르기 한 줄 (라디오 모양) */
function Option({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
    return (
        // 안에 입력창이 들어가서 button 대신 div(라디오 역할)
        <div
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onSelect()}
            className={cn("cursor-pointer",
                "flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm",
                selected ? "border-primary/40 bg-primary/5" : "border-border/70 hover:bg-muted/50",
            )}
        >
            <span className={cn("mt-1 size-3.5 shrink-0 rounded-full border-2", selected ? "border-primary bg-primary" : "border-muted-foreground/40")} />
            <span className="flex-1">{children}</span>
        </div>
    );
}

/**
 * 같은 기업 연결 해제 — 이 리드를 묶음에서 빼면서 기업명을 정한다.
 * 묶을 때 이름을 바꿨으면 원래 이름으로 되돌리거나, 다른 이름으로 바꾼다. 같은 이름이면 계속 같은 기업으로 보이므로 바꿔야 한다.
 */
export function UnlinkCompanyDialog({
    recordId,
    currentName,
    originalName,
    onOpenChange,
    onDone,
}: {
    recordId: number;
    currentName: string;
    originalName: string | null;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    const canRestore = !!originalName && companyKey(originalName) !== companyKey(currentName);
    const [mode, setMode] = useState<"restore" | "rename">(canRestore ? "restore" : "rename");
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const sameAsNow = mode === "rename" && companyKey(name) === companyKey(currentName);
    const ready = mode === "restore" || (name.trim() && !sameAsNow);

    const submit = async () => {
        setSaving(true);
        try {
            const r = await unlinkLead(recordId, mode === "rename" ? name.trim() : undefined);
            if (!r.success) {
                toast.error(r.error || "연결을 해제하지 못했습니다.");
                return;
            }
            toast.success("같은 기업 연결을 해제했어요.");
            onOpenChange(false);
            onDone();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => !saving && onOpenChange(v)}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>같은 기업 연결 해제</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        &apos;{currentName || "(기업명 없음)"}&apos;에서 이 리드를 뺍니다. 기업명을 어떻게 할까요?
                    </p>
                    {canRestore && (
                        <Option selected={mode === "restore"} onSelect={() => setMode("restore")}>
                            원래 이름 <span className="font-medium">&apos;{originalName}&apos;</span>으로 되돌리기
                        </Option>
                    )}
                    <Option selected={mode === "rename"} onSelect={() => setMode("rename")}>
                        다른 기업명으로 바꾸기
                        {mode === "rename" && (
                            <Input
                                autoFocus
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="새 기업명"
                                className="mt-2"
                                onClick={(e) => e.stopPropagation()}
                            />
                        )}
                        {sameAsNow && name.trim() && <span className="mt-1 block text-xs text-rose-600">지금과 같은 기업명이면 계속 같은 기업으로 묶여요.</span>}
                    </Option>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button disabled={saving || !ready} onClick={submit}>
                        연결 해제
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
