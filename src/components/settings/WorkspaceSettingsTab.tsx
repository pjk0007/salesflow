import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import IconPicker, { getIconComponent } from "@/components/ui/icon-picker";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog";
import DeleteWorkspaceDialog from "./DeleteWorkspaceDialog";

export default function WorkspaceSettingsTab() {
    const { workspaces, isLoading: wsListLoading, createWorkspace, deleteWorkspace, mutate: mutateList } = useWorkspaces();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { workspace, isLoading } = useWorkspaceSettings(selectedId);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icon, setIcon] = useState("");
    const [codePrefix, setCodePrefix] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

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
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    };

    const selectedWorkspace = workspaces.find((ws) => ws.id === selectedId) ?? null;

    if (wsListLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            {/* 카드 그리드 */}
            <div>
                <Label className="mb-3 block">워크스페이스 목록</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {workspaces.map((ws) => (
                        <Card
                            key={ws.id}
                            className={cn(
                                "cursor-pointer hover:border-primary/50 transition-colors",
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
                                    <div className="font-medium truncate">{ws.name}</div>
                                </div>
                                <div className="text-sm text-muted-foreground truncate mt-1">
                                    {ws.description || "설명 없음"}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
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
            </div>

            {/* 선택된 워크스페이스 편집 폼 */}
            {selectedId && (
                <>
                    <Separator />
                    {isLoading ? (
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

                            <div className="flex gap-2">
                                <Button onClick={handleSave} disabled={isSubmitting}>
                                    {isSubmitting ? "저장 중..." : "저장"}
                                </Button>
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
            />
        </div>
    );
}
