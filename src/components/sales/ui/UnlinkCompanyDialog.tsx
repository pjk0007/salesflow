"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { companyKey } from "@/components/leads/utils/lead-fields";
import { unlinkLeads } from "../api";
import { useSalesCompanies } from "../hooks/useSalesCompanies";

type Mode = "restore" | "pick" | "rename";

/** 고르기 한 줄 (라디오 모양) — 안에 입력창·드롭다운이 들어가서 button 대신 div */
function Option({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
    return (
        <div
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && onSelect()}
            className={cn(
                "flex w-full cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm",
                selected ? "border-primary/40 bg-primary/5" : "border-border/70 hover:bg-muted/50",
            )}
        >
            <span className={cn("mt-1 size-3.5 shrink-0 rounded-full border-2", selected ? "border-primary bg-primary" : "border-muted-foreground/40")} />
            <span className="min-w-0 flex-1">{children}</span>
        </div>
    );
}

/**
 * 묶인 기업에서 빼기 — 다른 기업으로 옮긴다: 기존 기업 목록에서 고르거나 새 기업명을 입력한다.
 * 묶을 때 이름이 바뀐 리드 하나면 "원래 이름으로 되돌리기"도 고를 수 있다. 여러 명을 한꺼번에 옮길 수도 있다.
 */
export function UnlinkCompanyDialog({
    recordIds,
    currentName,
    originalName,
    onOpenChange,
    onDone,
}: {
    recordIds: number[];
    currentName: string;
    /** 리드 하나이고 묶을 때 이름이 바뀌었으면 그 원래 이름 */
    originalName: string | null;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    const canRestore = recordIds.length === 1 && !!originalName && companyKey(originalName) !== companyKey(currentName);
    const [mode, setMode] = useState<Mode>(canRestore ? "restore" : "pick");
    const [picked, setPicked] = useState("");
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const { companies: all } = useSalesCompanies();
    const companies = useMemo(() => all.filter((c) => companyKey(c.name) !== companyKey(currentName)), [all, currentName]);
    const target = mode === "pick" ? picked : mode === "rename" ? name.trim() : "";
    const sameAsNow = mode !== "restore" && !!target && companyKey(target) === companyKey(currentName);
    const ready = mode === "restore" || (!!target && !sameAsNow);

    const submit = async () => {
        setSaving(true);
        try {
            const r = await unlinkLeads(recordIds, mode === "restore" ? undefined : target);
            if (!r.success) {
                toast.error(r.error || "빼지 못했습니다.");
                return;
            }
            toast.success(mode === "restore" ? "원래 기업명으로 되돌렸어요." : `${r.data?.done ?? recordIds.length}명을 '${target}'(으)로 옮겼어요.`);
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
                    <DialogTitle>묶인 기업에서 빼기</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        {recordIds.length > 1 ? `${recordIds.length}명을 ` : ""}&apos;{currentName || "(기업명 없음)"}&apos;에서 빼서 어느 기업으로 옮길까요?
                    </p>
                    {canRestore && (
                        <Option selected={mode === "restore"} onSelect={() => setMode("restore")}>
                            원래 이름 <span className="font-medium">&apos;{originalName}&apos;</span>으로 되돌리기
                        </Option>
                    )}
                    <Option selected={mode === "pick"} onSelect={() => setMode("pick")}>
                        다른 기업에서 고르기
                        {mode === "pick" && (
                            <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                    <DropdownMenuTrigger className="flex h-9 w-full items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-left text-sm outline-none">
                                        <span className={cn("min-w-0 flex-1 truncate", !picked && "text-muted-foreground")}>{picked || "기업 선택"}</span>
                                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
                                        {companies.length === 0 ? (
                                            <div className="px-2 py-1.5 text-sm text-muted-foreground">다른 기업이 없어요.</div>
                                        ) : (
                                            companies.map((c) => (
                                                <DropdownMenuItem key={c.name} onClick={() => setPicked(c.name)}>
                                                    <span className="flex-1">{c.name}</span>
                                                    <span className="text-xs text-muted-foreground">{c.count}명</span>
                                                    {picked === c.name && <Check className="h-4 w-4 text-primary" />}
                                                </DropdownMenuItem>
                                            ))
                                        )}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        )}
                    </Option>
                    <Option selected={mode === "rename"} onSelect={() => setMode("rename")}>
                        새 기업명 입력
                        {mode === "rename" && (
                            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="새 기업명" className="mt-2" onClick={(e) => e.stopPropagation()} />
                        )}
                        {sameAsNow && <span className="mt-1 block text-xs text-rose-600">지금과 같은 기업이에요. 다른 이름을 골라주세요.</span>}
                    </Option>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button disabled={saving || !ready} onClick={submit}>
                        빼기
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
