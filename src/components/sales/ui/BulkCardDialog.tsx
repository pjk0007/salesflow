"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useSession } from "@/contexts/SessionContext";
import { cn } from "@/lib/utils";
import { bulkCreateSalesLeads, scanBusinessCard } from "../api";
import { SALES_IMPORT_COLUMNS } from "../utils/import-fields";
import { OwnerSelect } from "./OwnerSelect";
import { WorkspaceChips } from "./WorkspaceChips";

type Row = { id: number; file: File; preview: string; status: "reading" | "done" | "error"; error?: string; values: Record<string, string> };
const COLS = SALES_IMPORT_COLUMNS.filter((c) => c.key !== "profileNote");
const CONCURRENCY = 3;

/** 명함 여러 장 — 한꺼번에 글자를 읽고 표에서 고친 뒤 한 번에 추가 */
export function BulkCardDialog({
    files,
    workspaceId,
    onOpenChange,
    onDone,
}: {
    files: File[];
    workspaceId: number | null;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    const { user } = useSession();
    const [rows, setRows] = useState<Row[]>(() =>
        files.map((f, i) => ({ id: i, file: f, preview: URL.createObjectURL(f), status: "reading", values: {} })),
    );
    const [workspaceIds, setWorkspaceIds] = useState<number[]>(workspaceId ? [workspaceId] : []);
    const [ownerId, setOwnerId] = useState<string | null>(user?.id ?? null);
    const [saving, setSaving] = useState(false);
    const started = useRef(false);

    // 3장씩 동시에 읽는다
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        let next = 0;
        const work = async () => {
            while (next < files.length) {
                const i = next++;
                const r = await scanBusinessCard(files[i]);
                setRows((prev) =>
                    prev.map((row) =>
                        row.id !== i
                            ? row
                            : r.success && r.data
                              ? {
                                    ...row,
                                    status: "done",
                                    values: Object.fromEntries(
                                        Object.entries({
                                            companyName: r.data.companyName,
                                            name: r.data.name,
                                            contactTitle: r.data.title,
                                            phone: r.data.phone,
                                            email: r.data.email,
                                            address: r.data.address ?? null,
                                        }).map(([k, v]) => [k, v ?? ""]),
                                    ),
                                }
                              : { ...row, status: "error", error: r.error || "글자를 읽지 못했어요." },
                    ),
                );
            }
        };
        Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, work));
    }, [files]);

    useEffect(() => () => rows.forEach((r) => URL.revokeObjectURL(r.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

    const reading = rows.filter((r) => r.status === "reading").length;
    const ready = rows.filter((r) => r.status !== "reading" && (r.values.companyName || r.values.name));
    const set = (id: number, key: string, v: string) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, values: { ...r.values, [key]: v } } : r)));

    const save = async () => {
        if (workspaceIds.length === 0) {
            toast.error("사업부를 하나 이상 골라주세요.");
            return;
        }
        setSaving(true);
        try {
            const result = await bulkCreateSalesLeads({ workspaceIds, ownerId, records: ready.map((r) => r.values), duplicateAction: "skip" });
            if (!result.success) {
                toast.error(result.error || "추가하지 못했습니다.");
                return;
            }
            toast.success(`명함 ${result.insertedCount}장을 영업 리드로 추가했어요.${result.skippedCount ? ` (이미 있는 이메일 ${result.skippedCount}건 건너뜀)` : ""}`);
            onOpenChange(false);
            onDone();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => !saving && onOpenChange(v)}>
            <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
                <DialogHeader className="border-b px-6 py-4">
                    <DialogTitle>명함 {files.length}장 등록</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 border-b px-6 py-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">사업부</Label>
                        <WorkspaceChips value={workspaceIds} onChange={setWorkspaceIds} />
                    </div>
                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">담당자 (일괄 적용)</Label>
                        <OwnerSelect value={ownerId} onChange={setOwnerId} className="-ml-2 text-sm" block />
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
                    <table className="w-full min-w-[960px] text-sm">
                        <thead className="sticky top-0 z-10 bg-background">
                            <tr className="border-b text-left text-xs text-muted-foreground">
                                <th className="w-24 px-3 py-2 font-medium">명함</th>
                                {COLS.map((c) => (
                                    <th key={c.key} className="px-2 py-2 font-medium">
                                        {c.label}
                                    </th>
                                ))}
                                <th className="w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-b border-border/40 align-top">
                                    <td className="px-3 py-2">
                                        {/* eslint-disable-next-line @next/next/no-img-element -- 올린 명함 미리보기 */}
                                        <img
                                            src={r.preview}
                                            alt=""
                                            className={cn("h-12 w-20 rounded border object-cover", r.status === "error" ? "border-rose-400" : "border-border/40")}
                                        />
                                        {r.status === "error" && (
                                            <span className="mt-1 inline-flex items-center gap-0.5 rounded bg-rose-100 px-1 text-[10px] text-rose-700" title={r.error}>
                                                <AlertCircle className="h-3 w-3" />
                                                읽지 못함
                                            </span>
                                        )}
                                    </td>
                                    {r.status === "reading" ? (
                                        <td colSpan={COLS.length} className="px-2 py-4 text-muted-foreground">
                                            <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> 글자 읽는 중…
                                        </td>
                                    ) : (
                                        COLS.map((c) => (
                                            <td key={c.key} className="px-1 py-1.5">
                                                <input
                                                    value={r.values[c.key] ?? ""}
                                                    onChange={(e) => set(r.id, c.key, e.target.value)}
                                                    placeholder={r.status === "error" && c.key === "companyName" ? "직접 입력" : ""}
                                                    className={cn(
                                                        "h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm outline-none hover:border-border/70 focus:border-border/70",
                                                        r.status === "error" && "placeholder:text-rose-500",
                                                    )}
                                                />
                                            </td>
                                        ))
                                    )}
                                    <td className="px-2 py-2">
                                        <button
                                            type="button"
                                            onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                                            className="rounded p-1 text-muted-foreground hover:text-destructive"
                                            aria-label="빼기"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        {reading > 0 ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {files.length - reading}/{files.length}장 읽음
                            </>
                        ) : rows.some((r) => r.status === "error") ? (
                            <>
                                <AlertCircle className="h-3.5 w-3.5 text-rose-500" /> 못 읽은 명함은 직접 채우거나 빼주세요.
                            </>
                        ) : (
                            "틀린 글자는 칸을 눌러 고친 뒤 추가하세요."
                        )}
                    </p>
                    <div className="flex gap-2">
                        <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                            취소
                        </Button>
                        <Button disabled={saving || reading > 0 || ready.length === 0} onClick={save}>
                            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                            {ready.length}명 추가
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
