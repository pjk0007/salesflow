"use client";

import { useState, useMemo, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import useSWR from "swr";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, CalendarClock, Trash2, Loader2 } from "lucide-react";
import FieldMappingStep from "../../import/FieldMappingStep";
import type { FieldDefinition } from "@/types";
import { defaultFetcher } from "@/lib/swr-fetcher";

const EXCLUDED_TYPES = ["file", "formula", "user_select"];

interface ScheduledRegConfig {
    enabled: boolean;
    timeOfDay: string;
    countPerDay: number;
    lastRunDate?: string;
}

interface ListResponse {
    success: boolean;
    data: {
        items: Array<{ id: number; data: Record<string, unknown>; sourceFileName: string | null; createdAt: string }>;
        total: number;
        page: number;
        totalPages: number;
        config: ScheduledRegConfig | null;
    };
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number | null;
    fields: FieldDefinition[];
}

export default function ScheduledRegistrationDialog({ open, onOpenChange, partitionId, fields }: Props) {
    const [tab, setTab] = useState("list");

    const mappableFields = useMemo(
        () => fields.filter((f) => !EXCLUDED_TYPES.includes(f.fieldType)),
        [fields],
    );

    const listKey = open && partitionId ? `/api/partitions/${partitionId}/scheduled-registrations` : null;
    const { data, mutate, isLoading } = useSWR<ListResponse>(listKey, defaultFetcher);

    const handleOpenChange = (v: boolean) => {
        if (!v) setTab("list");
        onOpenChange(v);
    };

    if (!partitionId) return null;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarClock className="h-5 w-5" />
                        예약 등록
                    </DialogTitle>
                    <DialogDescription>
                        CSV·엑셀을 업로드해 대기열에 쌓아두면 매일 지정 시각에 설정한 개수만큼 자동 등록됩니다.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="list">대기 목록</TabsTrigger>
                        <TabsTrigger value="upload">업로드</TabsTrigger>
                        <TabsTrigger value="settings">설정</TabsTrigger>
                    </TabsList>

                    <TabsContent value="list">
                        <ListTab
                            partitionId={partitionId}
                            data={data}
                            isLoading={isLoading}
                            fields={mappableFields}
                            onChanged={() => mutate()}
                        />
                    </TabsContent>

                    <TabsContent value="upload">
                        <UploadTab
                            partitionId={partitionId}
                            mappableFields={mappableFields}
                            onUploaded={() => {
                                mutate();
                                setTab("list");
                            }}
                        />
                    </TabsContent>

                    <TabsContent value="settings">
                        <SettingsTab
                            partitionId={partitionId}
                            config={data?.data.config ?? null}
                            onSaved={() => mutate()}
                        />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

// ─────────────────────────── 대기 목록 탭 ───────────────────────────
function ListTab({
    partitionId,
    data,
    isLoading,
    fields,
    onChanged,
}: {
    partitionId: number;
    data: ListResponse | undefined;
    isLoading: boolean;
    fields: FieldDefinition[];
    onChanged: () => void;
}) {
    const [clearing, setClearing] = useState(false);
    const items = data?.data.items ?? [];
    const total = data?.data.total ?? 0;
    const config = data?.data.config ?? null;

    // 데이터에 등장하는 키 → 필드 라벨 순서로 컬럼 구성
    const columns = useMemo(() => {
        const keys = new Set<string>();
        for (const it of items) for (const k of Object.keys(it.data)) keys.add(k);
        const cols = fields.filter((f) => keys.has(f.key)).map((f) => ({ key: f.key, label: f.label }));
        for (const k of keys) if (!cols.some((c) => c.key === k)) cols.push({ key: k, label: k });
        return cols;
    }, [items, fields]);

    const nextRun = config?.enabled
        ? `매일 ${config.timeOfDay} · ${config.countPerDay.toLocaleString()}건씩`
        : "예약 등록 비활성 (설정 탭에서 켜기)";

    const handleClearAll = async () => {
        if (!confirm(`대기 중인 ${total.toLocaleString()}건을 모두 삭제할까요?`)) return;
        setClearing(true);
        try {
            const res = await fetch(`/api/partitions/${partitionId}/scheduled-registrations`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (json.success) {
                toast.success(`${json.data.deleted.toLocaleString()}건 삭제됨`);
                onChanged();
            } else {
                toast.error(json.error ?? "삭제 실패");
            }
        } finally {
            setClearing(false);
        }
    };

    return (
        <div className="space-y-3 py-2">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div>
                    <span className="font-medium">대기 {total.toLocaleString()}건</span>
                    <span className="text-muted-foreground"> · {nextRun}</span>
                </div>
                {total > 0 && (
                    <Button variant="ghost" size="sm" onClick={handleClearAll} disabled={clearing} className="gap-1 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                        전체 삭제
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : items.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">대기 중인 예약 등록이 없습니다.</div>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">위에서부터 등록 예정 순서(먼저 올린 순)입니다.</p>
                    <div className="max-h-[360px] overflow-auto rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground w-12">#</th>
                                    {columns.map((c) => (
                                        <th key={c.key} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                                            {c.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {items.map((it, i) => (
                                    <tr key={it.id} className="hover:bg-muted/30">
                                        <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                                        {columns.map((c) => (
                                            <td key={c.key} className="px-3 py-1.5 whitespace-nowrap" title={String(it.data[c.key] ?? "")}>
                                                {String(it.data[c.key] ?? "")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {total > items.length && (
                        <p className="text-center text-xs text-muted-foreground">
                            외 {(total - items.length).toLocaleString()}건 더…
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

// ─────────────────────────── 업로드 탭 ───────────────────────────
function UploadTab({
    partitionId,
    mappableFields,
    onUploaded,
}: {
    partitionId: number;
    mappableFields: FieldDefinition[];
    onUploaded: () => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [headers, setHeaders] = useState<string[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [dupAction, setDupAction] = useState<"skip" | "error">("skip");
    const [uploading, setUploading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const activeMappings = useMemo(() => Object.entries(mapping).filter(([, v]) => v), [mapping]);

    // 헤더만 클라이언트 파싱 (대용량 회피) — 전체 파싱은 서버 담당
    const readHeader = (f: File) => {
        const name = f.name.toLowerCase();
        const buildMapping = (hs: string[]) => {
            const auto: Record<string, string> = {};
            for (const h of hs) {
                const m = mappableFields.find((fd) => fd.label === h);
                if (m) auto[h] = m.key;
            }
            setHeaders(hs);
            setMapping(auto);
        };
        if (name.endsWith(".csv")) {
            Papa.parse<string[]>(f, {
                header: false,
                preview: 1,
                skipEmptyLines: true,
                complete: (r) => buildMapping((r.data[0] as string[]) ?? []),
            });
        } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(e.target?.result, { type: "array" });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "", raw: false });
                    buildMapping((rows[0] ?? []).map((c) => String(c ?? "")));
                } catch {
                    toast.error("엑셀 파일을 읽지 못했습니다.");
                }
            };
            reader.readAsArrayBuffer(f);
        } else {
            toast.error("CSV 또는 엑셀(.xlsx, .xls) 파일만 업로드할 수 있습니다.");
            return;
        }
        setFile(f);
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("mapping", JSON.stringify(Object.fromEntries(activeMappings)));
            const res = await fetch(`/api/partitions/${partitionId}/scheduled-registrations/upload`, {
                method: "POST",
                body: fd,
            });
            const json = await res.json();
            if (json.success) {
                toast.success(`${json.data.inserted.toLocaleString()}건이 예약 등록 대기열에 추가됐습니다.`);
                setFile(null);
                setHeaders([]);
                setMapping({});
                onUploaded();
            } else {
                toast.error(json.error ?? "업로드 실패");
            }
        } catch {
            toast.error("업로드 중 오류가 발생했습니다.");
        } finally {
            setUploading(false);
        }
    };

    if (headers.length === 0) {
        return (
            <div className="space-y-3 py-2">
                <div
                    className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${isDragging ? "border-primary bg-primary/5" : "hover:border-primary/50"}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) readHeader(f); }}
                >
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                    <p className="text-sm text-muted-foreground mt-2">
                        {isDragging ? "여기에 놓아서 업로드하세요" : "CSV·엑셀 파일을 끌어다 놓거나 클릭하여 선택하세요"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">CSV, XLSX, XLS · 행 제한 없음</p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) readHeader(f); e.target.value = ""; }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground truncate">파일: <span className="text-foreground font-medium">{file?.name}</span></div>
            <FieldMappingStep
                csvHeaders={headers}
                mapping={mapping}
                onMappingChange={setMapping}
                mappableFields={mappableFields}
                duplicateAction={dupAction}
                onDuplicateActionChange={setDupAction}
            />
            <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setFile(null); setHeaders([]); setMapping({}); }}>
                    다른 파일
                </Button>
                <Button onClick={handleUpload} disabled={uploading || activeMappings.length === 0}>
                    {uploading ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />업로드 중...</> : "대기열에 추가"}
                </Button>
            </div>
        </div>
    );
}

// ─────────────────────────── 설정 탭 ───────────────────────────
function SettingsTab({
    partitionId,
    config,
    onSaved,
}: {
    partitionId: number;
    config: ScheduledRegConfig | null;
    onSaved: () => void;
}) {
    const [enabled, setEnabled] = useState(config?.enabled ?? false);
    const [timeOfDay, setTimeOfDay] = useState(config?.timeOfDay ?? "09:00");
    const [countPerDay, setCountPerDay] = useState(config?.countPerDay ?? 100);
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (countPerDay < 1) {
            toast.error("하루 등록 개수는 1 이상이어야 합니다.");
            return;
        }
        setSaving(true);
        try {
            // 정각으로 정규화 (HH:00)
            const normalizedTime = `${(timeOfDay.split(":")[0] || "09").padStart(2, "0")}:00`;
            const res = await fetch(`/api/partitions/${partitionId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scheduledRegistrationConfig: { enabled, timeOfDay: normalizedTime, countPerDay } }),
            });
            const json = await res.json();
            if (json.success) {
                toast.success("예약 등록 설정이 저장됐습니다.");
                onSaved();
            } else {
                toast.error(json.error ?? "저장 실패");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5 py-3">
            <div className="flex items-center justify-between">
                <div>
                    <Label className="text-sm font-medium">예약 등록 사용</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">매일 지정 시각에 대기열에서 자동 등록합니다.</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <Label className="text-sm">실행 시각 (KST, 정각)</Label>
                    <Select
                        value={String(Number(timeOfDay.split(":")[0]) || 0)}
                        onValueChange={(v) => setTimeOfDay(`${v.padStart(2, "0")}:00`)}
                        disabled={!enabled}
                    >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {Array.from({ length: 24 }, (_, h) => (
                                <SelectItem key={h} value={String(h)}>{`${String(h).padStart(2, "0")}:00`}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="reg-count" className="text-sm">하루 등록 개수</Label>
                    <Input id="reg-count" type="number" min={1} value={countPerDay} onChange={(e) => setCountPerDay(Number(e.target.value))} disabled={!enabled} />
                </div>
            </div>

            {config?.lastRunDate && (
                <p className="text-xs text-muted-foreground">마지막 실행일: {config.lastRunDate}</p>
            )}

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? "저장 중..." : "저장"}
                </Button>
            </div>
        </div>
    );
}
