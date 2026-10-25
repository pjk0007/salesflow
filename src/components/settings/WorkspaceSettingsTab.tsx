import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { useFieldTypes } from "@/hooks/useFieldTypes";
import IconPicker, { getIconComponent } from "@/components/ui/icon-picker";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog";
import DeleteWorkspaceDialog from "./DeleteWorkspaceDialog";

export default function WorkspaceSettingsTab() {
    const { allWorkspaces: workspaces, isLoading: wsListLoading, createWorkspace, deleteWorkspace, loadError: listError, mutate: mutateList } = useWorkspaces();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { workspace, isLoading, updateWorkspace, loadError: workspaceError, mutate: mutateWorkspace } = useWorkspaceSettings(selectedId);
    const { fieldTypes: types, loadError: typesError, mutate: mutateTypes } = useFieldTypes();

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icon, setIcon] = useState("");
    const [codePrefix, setCodePrefix] = useState("");
    const [defaultFieldTypeId, setDefaultFieldTypeId] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isTogglingHidden, setIsTogglingHidden] = useState(false);
    const [showHidden, setShowHidden] = useState(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    // 첫 번째 워크스페이스 자동 선택
    useEffect(() => {
        if (workspaces.length > 0 && selectedId === null) {
            setSelectedId(workspaces[0].id);
        }
    }, [workspaces, selectedId]);

    // 워크스페이스 데이터로 폼 초기화
    useEffect(() => {
        if (workspace) {
            setName(workspace.name);
            setDescription(workspace.description ?? "");
            setIcon(workspace.icon ?? "");
            setCodePrefix(workspace.codePrefix ?? "");
            setDefaultFieldTypeId(workspace.defaultFieldTypeId ? String(workspace.defaultFieldTypeId) : "");
        }
    }, [workspace]);

    const handleSave = async () => {
        if (!selectedId) return;
        if (!name.trim()) {
            toast.error("이름을 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch(`/api/workspaces/${selectedId}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim() || null,
                    icon: icon.trim() || null,
                    codePrefix: codePrefix.trim() || null,
                    defaultFieldTypeId: defaultFieldTypeId ? Number(defaultFieldTypeId) : null,
                }),
            });
            const result = await res.json();
            if (result.success) {
                toast.success("워크스페이스 설정이 저장되었습니다.");
                mutateList();
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleToggleHidden = async () => {
        if (!workspace) return;
        const hidden = !workspace.hiddenAt;
        setIsTogglingHidden(true);
        try {
            const result = await updateWorkspace({ hidden });
            if (result.success) {
                toast.success(hidden ? "워크스페이스를 숨겼습니다. 데이터는 그대로 남아 있습니다." : "워크스페이스를 다시 표시합니다.");
                if (hidden) setShowHidden(true);
                mutateList();
            } else {
                toast.error(result.error || "변경에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsTogglingHidden(false);
        }
    };

    const handleCreate = async (input: Parameters<typeof createWorkspace>[0]) => {
        const result = await createWorkspace(input);
        if (result.success && result.data) {
            setSelectedId(result.data.id);
        }
        return result;
    };

    const handleDelete = async () => {
        if (!selectedId) return;
        const result = await deleteWorkspace(selectedId);
        if (result.success) {
            toast.success("워크스페이스가 삭제되었습니다.");
            setSelectedId(null);
            setDeleteOpen(false);
        } else {
            throw new Error(result.error || "삭제에 실패했습니다.");
        }
    };

    const selectedWorkspace = workspaces.find((ws) => ws.id === selectedId) ?? null;
    const visibleWorkspaces = workspaces.filter((ws) => !ws.hiddenAt);
    const hiddenWorkspaces = workspaces.filter((ws) => ws.hiddenAt);

    const renderCard = (ws: (typeof workspaces)[number]) => (
        <Card
            key={ws.id}
            className={cn(
                "cursor-pointer hover:border-primary/50 transition-colors",
                ws.hiddenAt && "bg-muted/40",
                selectedId === ws.id && "border-primary ring-1 ring-primary"
            )}
            onClick={() => setSelectedId(ws.id)}
        >
            <CardContent className="p-4">
                <div className="flex items-center gap-2">
                    {ws.icon && (() => {
                        const Icon = getIconComponent(ws.icon);
                        return Icon ? <Icon className="h-4 w-4 text-muted-foreground shrink-0" /> : null;
                    })()}
                    <div className={cn("font-medium truncate", ws.hiddenAt && "text-muted-foreground")}>{ws.name}</div>
                    {ws.hiddenAt && <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-auto" />}
                </div>
                <div className="text-sm text-muted-foreground truncate mt-1">
                    {ws.description || "설명 없음"}
                </div>
            </CardContent>
        </Card>
    );

    if (listError) return <QueryErrorState error={listError} onRetry={() => mutateList()} />;

    if (wsListLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            {/* 카드 그리드 */}
            <div>
                <Label className="mb-3 block">워크스페이스 목록</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {visibleWorkspaces.map(renderCard)}
                    <Card
                        className="cursor-pointer hover:border-primary/50 transition-colors border-dashed"
                        onClick={() => setCreateOpen(true)}
                    >
                        <CardContent className="p-4 flex items-center justify-center text-muted-foreground gap-1">
                            <Plus className="h-4 w-4" />
                            추가
                        </CardContent>
                    </Card>
                </div>
                {hiddenWorkspaces.length > 0 && (
                    <div className="mt-4">
                        <button
                            type="button"
                            className="text-sm text-muted-foreground hover:text-foreground"
                            onClick={() => setShowHidden((v) => !v)}
                        >
                            숨긴 워크스페이스 {hiddenWorkspaces.length}개 {showHidden ? "접기" : "보기"}
                        </button>
                        {showHidden && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                                {hiddenWorkspaces.map(renderCard)}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 선택된 워크스페이스 편집 폼 */}
            {selectedId && (
                <>
                    <Separator />
                    {workspaceError || typesError ? (
                        <QueryErrorState error={workspaceError || typesError} onRetry={() => Promise.all([mutateWorkspace(), mutateTypes()])} />
                    ) : isLoading ? (
                        <div className="text-muted-foreground py-4 text-center">로딩 중...</div>
                    ) : (
                        <div className="space-y-4 max-w-lg">
                            <div className="space-y-1.5">
                                <Label>
                                    이름 <span className="text-destructive">*</span>
                                </Label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="워크스페이스 이름"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label>설명</Label>
                                <Textarea
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="워크스페이스 설명"
                                    rows={3}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label>아이콘</Label>
                                <IconPicker value={icon} onChange={setIcon} />
                            </div>

                            <div className="space-y-1.5">
                                <Label>기본 속성 타입</Label>
                                <Select value={defaultFieldTypeId} onValueChange={setDefaultFieldTypeId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="속성 타입 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {types.map((t) => (
                                            <SelectItem key={t.id} value={String(t.id)}>
                                                {t.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    파티션에 별도 타입을 지정하지 않으면 이 타입이 적용됩니다.
                                </p>
                            </div>

                            <div className="space-y-1.5">
                                <Label>통합 코드 접두어</Label>
                                <Input
                                    value={codePrefix}
                                    onChange={(e) => setCodePrefix(e.target.value)}
                                    placeholder="SALES"
                                />
                                <p className="text-xs text-muted-foreground">
                                    레코드 코드에 이 접두어가 붙습니다.
                                </p>
                            </div>

                            {workspace?.hiddenAt && (
                                <p className="text-sm text-muted-foreground">
                                    숨긴 워크스페이스입니다. 레코드·웹폼 등 선택 목록에서만 빠지고, 데이터와 자동 발송·트래커·연동은 그대로 동작합니다.
                                </p>
                            )}

                            <div className="flex gap-2">
                                <Button onClick={handleSave} disabled={isSubmitting}>
                                    {isSubmitting ? "저장 중..." : "저장"}
                                </Button>
                                {workspace && (
                                    <Button
                                        variant="outline"
                                        onClick={handleToggleHidden}
                                        disabled={isTogglingHidden}
                                    >
                                        {workspace.hiddenAt ? (
                                            <><Eye className="h-4 w-4 mr-1" />다시 표시</>
                                        ) : (
                                            <><EyeOff className="h-4 w-4 mr-1" />숨기기</>
                                        )}
                                    </Button>
                                )}
                                {workspaces.length > 1 && (
                                    <Button
                                        variant="destructive"
                                        onClick={() => setDeleteOpen(true)}
                                    >
                                        삭제
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            <CreateWorkspaceDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSubmit={handleCreate}
            />
            <DeleteWorkspaceDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                workspace={selectedWorkspace}
                onConfirm={handleDelete}
                onHide={selectedWorkspace && !selectedWorkspace.hiddenAt ? () => { setDeleteOpen(false); void handleToggleHidden(); } : undefined}
            />
        </div>
    );
}
