import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import { useFieldTypes } from "@/hooks/useFieldTypes";
import IconPicker, { getIconComponent } from "@/components/ui/icon-picker";
import { useSession } from "@/contexts/SessionContext";
import ReplyToEmailField from "@/components/email/reply-to/ui/ReplyToEmailField";
import { replyToFieldValue, type MxStatus } from "@/components/email/reply-to/utils/replyTo";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog";
import DeleteWorkspaceDialog from "./DeleteWorkspaceDialog";

export default function WorkspaceSettingsTab() {
    const { workspaces, isLoading: wsListLoading, createWorkspace, deleteWorkspace, mutate: mutateList } = useWorkspaces();
    const searchParams = useSearchParams();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { workspace, isLoading, mutate: mutateSettings } = useWorkspaceSettings(selectedId);
    const { fieldTypes: types } = useFieldTypes();
    const { user } = useSession();
    // 답장 받을 주소는 관리자(owner·admin)만 바꾼다 (서버도 멤버는 403)
    const canEditReplyTo = user?.role === "owner" || user?.role === "admin";

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icon, setIcon] = useState("");
    const [codePrefix, setCodePrefix] = useState("");
    const [defaultFieldTypeId, setDefaultFieldTypeId] = useState<string>("");
    const [replyToEmail, setReplyToEmail] = useState("");
    const [replyToError, setReplyToError] = useState<string | null>(null);
    // 마지막 저장 응답의 MX 결과 (그때 저장한 워크스페이스·주소와 함께). 없으면 불러온 설정의 replyToMx를 쓴다 — 열 때도 경고가 보인다
    const [replyToCheck, setReplyToCheck] = useState<{ workspaceId: number; email: string | null; mx: MxStatus | null } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [createOpen, setCreateOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    // 첫 워크스페이스 자동 선택. 주소에 ?workspaceId=가 있으면(AI 규칙 화면의 "답장 받을 주소 정하기" 링크) 그 워크스페이스
    useEffect(() => {
        if (workspaces.length > 0 && selectedId === null) {
            const wanted = Number(searchParams.get("workspaceId"));
            const fromQuery = workspaces.find((ws) => ws.id === wanted);
            setSelectedId(fromQuery ? fromQuery.id : workspaces[0].id);
        }
    }, [workspaces, selectedId, searchParams]);

    // 워크스페이스 데이터로 폼 초기화
    useEffect(() => {
        if (workspace) {
            setName(workspace.name);
            setDescription(workspace.description ?? "");
            setIcon(workspace.icon ?? "");
            setCodePrefix(workspace.codePrefix ?? "");
            setDefaultFieldTypeId(workspace.defaultFieldTypeId ? String(workspace.defaultFieldTypeId) : "");
            setReplyToEmail(workspace.replyToEmail ?? "");
            setReplyToError(null);
        }
    }, [workspace]);

    const handleSave = async () => {
        if (!selectedId) return;
        if (!name.trim()) {
            toast.error("이름을 입력해주세요.");
            return;
        }
        // 답장 받을 주소는 서버와 같은 검사로 먼저 거른다 (헤더에 들어가는 값). 비우면 null — 답장 주소 없음
        const parsedReplyTo = replyToFieldValue(replyToEmail);
        if (canEditReplyTo && !parsedReplyTo.ok) {
            setReplyToError(parsedReplyTo.error);
            toast.error(parsedReplyTo.error);
            return;
        }

        setIsSubmitting(true);
        try {
            const sentReplyTo = parsedReplyTo.ok ? parsedReplyTo.value : null;
            const res = await fetch(`/api/workspaces/${selectedId}/settings`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim() || null,
                    icon: icon.trim() || null,
                    codePrefix: codePrefix.trim() || null,
                    defaultFieldTypeId: defaultFieldTypeId ? Number(defaultFieldTypeId) : null,
                    // null = 답장 주소 없음 (Reply-To 헤더를 넣지 않는다). 멤버는 보내지 않는다 (서버도 403)
                    ...(canEditReplyTo ? { replyToEmail: sentReplyTo } : {}),
                }),
            });
            const result = await res.json();
            if (result.success) {
                // 서버가 다듬어 저장한 값(앞뒤 공백 등)과 MX 결과. MX가 없어도 저장은 된다 — 칸 아래 노란 경고로 알린다
                const savedReplyTo: string | null =
                    result.data && result.data.replyToEmail !== undefined ? result.data.replyToEmail : sentReplyTo;
                const mx: MxStatus | null = result.mx ?? null;
                if (canEditReplyTo) setReplyToCheck({ workspaceId: selectedId, email: savedReplyTo, mx });
                if (canEditReplyTo && savedReplyTo && mx === "none") {
                    toast.warning("저장했습니다. 다만 답장 받을 주소의 도메인이 메일을 받지 않습니다 — 칸 아래 경고를 확인하세요.");
                } else {
                    toast.success("워크스페이스 설정이 저장되었습니다.");
                }
                mutateSettings();
                mutateList();
            } else {
                // 서버가 답장 받을 주소를 거절했으면(형식·길이) 그 칸 아래에도 보인다
                if (typeof result.error === "string" && result.error.includes("답장 받을 주소")) setReplyToError(result.error);
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

                            <ReplyToEmailField
                                value={replyToEmail}
                                onChange={(v) => {
                                    setReplyToEmail(v);
                                    setReplyToError(null);
                                }}
                                lastCheck={
                                    replyToCheck?.workspaceId === selectedId
                                        ? replyToCheck
                                        : workspace
                                          ? { email: workspace.replyToEmail ?? null, mx: workspace.replyToMx ?? null }
                                          : null
                                }
                                error={replyToError}
                                disabled={!canEditReplyTo}
                            />

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
