import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { usePartitions } from "@/hooks/usePartitions";
import { Plus, X, Loader2 } from "lucide-react";

interface ScopeInput {
    scopeType: "workspace" | "folder" | "partition";
    scopeId: number;
    scopeName: string;
    permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
}

interface ApiTokenCreateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: "create" | "edit";
    token?: {
        id: number;
        name: string;
        scopes: Array<{
            scopeType: string;
            scopeId: number;
            scopeName?: string;
            permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
        }>;
    };
    onSubmit: (input: {
        name: string;
        expiresIn: "30d" | "90d" | "1y" | null;
        scopes: Array<{
            scopeType: "workspace" | "folder" | "partition";
            scopeId: number;
            permissions: { read: boolean; create: boolean; update: boolean; delete: boolean };
        }>;
    }) => Promise<{ success: boolean; data?: { token?: string }; error?: string }>;
}

export default function ApiTokenCreateDialog({
    open,
    onOpenChange,
    mode,
    token,
    onSubmit,
}: ApiTokenCreateDialogProps) {
    const { workspaces } = useWorkspaces();

    const [name, setName] = useState("");
    const [expiresIn, setExpiresIn] = useState<string>("none");
    const [scopes, setScopes] = useState<ScopeInput[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // 범위 추가 Popover state
    const [addScopeOpen, setAddScopeOpen] = useState(false);
    const [newScopeType, setNewScopeType] = useState<"workspace" | "folder" | "partition">("workspace");
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null);
    const [selectedScopeId, setSelectedScopeId] = useState<number | null>(null);

    const { partitionTree } = usePartitions(selectedWorkspaceId);

    useEffect(() => {
        if (open) {
            if (mode === "edit" && token) {
                setName(token.name);
                setExpiresIn("none");
                setScopes(
                    token.scopes.map((s) => ({
                        scopeType: s.scopeType as "workspace" | "folder" | "partition",
                        scopeId: s.scopeId,
                        scopeName: s.scopeName ?? "",
                        permissions: { ...s.permissions },
                    }))
                );
            } else {
                setName("");
                setExpiresIn("none");
                setScopes([]);
            }
        }
    }, [open, mode, token]);

    const handleAddScope = () => {
        if (!selectedScopeId) return;

        // 중복 체크
        if (scopes.some((s) => s.scopeType === newScopeType && s.scopeId === selectedScopeId)) {
            toast.error("이미 추가된 범위입니다.");
            return;
        }

        let scopeName = "";
        if (newScopeType === "workspace") {
            scopeName = workspaces.find((w) => w.id === selectedScopeId)?.name ?? "";
        } else if (newScopeType === "folder" && partitionTree) {
            scopeName = partitionTree.folders.find((f) => f.id === selectedScopeId)?.name ?? "";
        } else if (newScopeType === "partition" && partitionTree) {
            for (const f of partitionTree.folders) {
                const p = f.partitions.find((p) => p.id === selectedScopeId);
                if (p) { scopeName = p.name; break; }
            }
            if (!scopeName) {
                scopeName = partitionTree.ungrouped.find((p) => p.id === selectedScopeId)?.name ?? "";
            }
        }

        setScopes([
            ...scopes,
            {
                scopeType: newScopeType,
                scopeId: selectedScopeId,
                scopeName,
                permissions: { read: true, create: false, update: false, delete: false },
            },
        ]);
        setAddScopeOpen(false);
        setSelectedScopeId(null);
    };

    const removeScope = (idx: number) => {
        setScopes(scopes.filter((_, i) => i !== idx));
    };

    const togglePermission = (idx: number, perm: keyof ScopeInput["permissions"]) => {
        setScopes(
            scopes.map((s, i) =>
                i === idx ? { ...s, permissions: { ...s.permissions, [perm]: !s.permissions[perm] } } : s
            )
        );
    };

    const handleSubmit = async () => {
        if (!name.trim()) {
            toast.error("토큰 이름을 입력해주세요.");
            return;
        }
        if (scopes.length === 0) {
            toast.error("권한 범위를 최소 1개 설정해야 합니다.");
            return;
        }

        setSubmitting(true);
        try {
            const result = await onSubmit({
                name: name.trim(),
                expiresIn: expiresIn === "none" ? null : (expiresIn as "30d" | "90d" | "1y"),
                scopes: scopes.map((s) => ({
                    scopeType: s.scopeType,
                    scopeId: s.scopeId,
                    permissions: s.permissions,
                })),
            });

            if (result.success) {
                onOpenChange(false);
            } else {
                toast.error(result.error || "오류가 발생했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setSubmitting(false);
        }
    };

    const scopeTypeLabel = { workspace: "워크스페이스", folder: "폴더", partition: "파티션" };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{mode === "create" ? "API 토큰 생성" : "API 토큰 수정"}</DialogTitle>
                    <DialogDescription>
                        {mode === "create"
                            ? "외부 시스템에서 사용할 API 토큰을 생성합니다."
                            : "토큰 설정을 수정합니다."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>토큰 이름 <span className="text-destructive">*</span></Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="예: 웹사이트 연동"
                            maxLength={100}
                        />
                    </div>

                    {mode === "create" && (
                        <div className="space-y-1.5">
                            <Label>만료 기간</Label>
                            <Select value={expiresIn} onValueChange={setExpiresIn}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">무제한</SelectItem>
                                    <SelectItem value="30d">30일</SelectItem>
                                    <SelectItem value="90d">90일</SelectItem>
                                    <SelectItem value="1y">1년</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>권한 범위 <span className="text-destructive">*</span></Label>
                            <Popover open={addScopeOpen} onOpenChange={setAddScopeOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        범위 추가
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-72 space-y-3" align="end">
                                    <div className="space-y-1.5">
                                        <Label className="text-xs">범위 유형</Label>
                                        <RadioGroup
                                            value={newScopeType}
                                            onValueChange={(v) => {
                                                setNewScopeType(v as "workspace" | "folder" | "partition");
                                                setSelectedScopeId(null);
                                            }}
                                            className="flex gap-3"
                                        >
                                            <div className="flex items-center gap-1">
                                                <RadioGroupItem value="workspace" id="scope-ws" />
                                                <Label htmlFor="scope-ws" className="text-xs font-normal cursor-pointer">워크스페이스</Label>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <RadioGroupItem value="folder" id="scope-folder" />
                                                <Label htmlFor="scope-folder" className="text-xs font-normal cursor-pointer">폴더</Label>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <RadioGroupItem value="partition" id="scope-partition" />
                                                <Label htmlFor="scope-partition" className="text-xs font-normal cursor-pointer">파티션</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>

                                    {newScopeType === "workspace" ? (
                                        <div className="space-y-1.5">
                                            <Label className="text-xs">워크스페이스</Label>
                                            <Select
                                                value={selectedScopeId?.toString() ?? ""}
                                                onValueChange={(v) => setSelectedScopeId(Number(v))}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="선택" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {workspaces.map((ws) => (
                                                        <SelectItem key={ws.id} value={String(ws.id)}>
                                                            {ws.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs">워크스페이스</Label>
                                                <Select
                                                    value={selectedWorkspaceId?.toString() ?? ""}
                                                    onValueChange={(v) => {
                                                        setSelectedWorkspaceId(Number(v));
                                                        setSelectedScopeId(null);
                                                    }}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="선택" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {workspaces.map((ws) => (
                                                            <SelectItem key={ws.id} value={String(ws.id)}>
                                                                {ws.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            {selectedWorkspaceId && partitionTree && (
                                                <div className="space-y-1.5">
                                                    <Label className="text-xs">
                                                        {newScopeType === "folder" ? "폴더" : "파티션"}
                                                    </Label>
                                                    <Select
                                                        value={selectedScopeId?.toString() ?? ""}
                                                        onValueChange={(v) => setSelectedScopeId(Number(v))}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="선택" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {newScopeType === "folder"
                                                                ? partitionTree.folders.map((f) => (
                                                                    <SelectItem key={f.id} value={String(f.id)}>
                                                                        {f.name}
                                                                    </SelectItem>
                                                                ))
                                                                : [
                                                                    ...partitionTree.folders.flatMap((f) =>
                                                                        f.partitions.map((p) => (
                                                                            <SelectItem key={p.id} value={String(p.id)}>
                                                                                {f.name} / {p.name}
                                                                            </SelectItem>
                                                                        ))
                                                                    ),
                                                                    ...partitionTree.ungrouped.map((p) => (
                                                                        <SelectItem key={p.id} value={String(p.id)}>
                                                                            {p.name}
                                                                        </SelectItem>
                                                                    )),
                                                                ]}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    <Button
                                        size="sm"
                                        className="w-full"
                                        disabled={!selectedScopeId}
                                        onClick={handleAddScope}
                                    >
                                        추가
                                    </Button>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {scopes.length === 0 ? (
                            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                                범위를 추가해주세요.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {scopes.map((scope, idx) => (
                                    <div key={idx} className="rounded-md border p-3 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-medium">
                                                <span className="text-muted-foreground text-xs mr-1.5">
                                                    [{scopeTypeLabel[scope.scopeType]}]
                                                </span>
                                                {scope.scopeName}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => removeScope(idx)}
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                        <div className="flex gap-4">
                                            {(["read", "create", "update", "delete"] as const).map((perm) => (
                                                <label key={perm} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                                    <Checkbox
                                                        checked={scope.permissions[perm]}
                                                        onCheckedChange={() => togglePermission(idx, perm)}
                                                    />
                                                    {{ read: "조회", create: "생성", update: "수정", delete: "삭제" }[perm]}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting}>
                        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {mode === "create" ? "생성" : "저장"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
