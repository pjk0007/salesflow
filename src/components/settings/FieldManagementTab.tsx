import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, Plus, Pencil, Trash2, Lock, LayoutTemplate } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useFields } from "@/hooks/useFields";
import { useFieldManagement } from "@/hooks/useFieldManagement";
import CreateFieldDialog from "./CreateFieldDialog";
import EditFieldDialog from "./EditFieldDialog";
import DeleteFieldDialog from "./DeleteFieldDialog";
import TemplatePickerDialog from "./TemplatePickerDialog";
import { toast } from "sonner";
import type { FieldDefinition } from "@/types";

const FIELD_TYPE_LABELS: Record<string, string> = {
    text: "텍스트",
    number: "숫자",
    currency: "금액",
    date: "날짜",
    datetime: "날짜+시간",
    select: "선택",
    phone: "전화번호",
    email: "이메일",
    textarea: "장문 텍스트",
    checkbox: "체크박스",
    file: "파일",
    formula: "수식",
    user_select: "사용자 선택",
};

export default function FieldManagementTab() {
    const { workspaces, isLoading: wsLoading } = useWorkspaces();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { fields, isLoading: fieldsLoading, mutate } = useFields(selectedId);
    const { createField, updateField, deleteField, reorderFields, applyTemplate } = useFieldManagement(selectedId, mutate);

    const [createOpen, setCreateOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<FieldDefinition | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string; key: string } | null>(null);
    const [templateOpen, setTemplateOpen] = useState(false);
    const [isApplying, setIsApplying] = useState(false);

    useEffect(() => {
        if (workspaces.length > 0 && selectedId === null) {
            setSelectedId(workspaces[0].id);
        }
    }, [workspaces, selectedId]);

    const handleMoveUp = async (index: number) => {
        if (index <= 0) return;
        const ids = fields.map((f) => f.id);
        [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
        await reorderFields(ids);
    };

    const handleMoveDown = async (index: number) => {
        if (index >= fields.length - 1) return;
        const ids = fields.map((f) => f.id);
        [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
        await reorderFields(ids);
    };

    const handleEdit = (field: FieldDefinition) => {
        setEditTarget(field);
        setEditOpen(true);
    };

    const handleDelete = (field: FieldDefinition) => {
        setDeleteTarget({ id: field.id, label: field.label, key: field.key });
        setDeleteOpen(true);
    };

    const handleApplyTemplate = async (templateId: string) => {
        setIsApplying(true);
        try {
            const result = await applyTemplate(templateId);
            if (result.success) {
                const { created, skipped } = result.data;
                if (created > 0 && skipped > 0) {
                    toast.success(`${created}개 속성이 추가되었습니다. ${skipped}개는 이미 존재하여 건너뛰었습니다.`);
                } else if (created > 0) {
                    toast.success(`${created}개 속성이 추가되었습니다.`);
                } else {
                    toast.info("이미 모든 속성이 존재합니다.");
                }
                setTemplateOpen(false);
            } else {
                toast.error(result.error || "템플릿 적용에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsApplying(false);
        }
    };

    if (wsLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    return (
        <div className="space-y-6">
            {/* 워크스페이스 선택 */}
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
                                <div className="font-medium truncate">{ws.name}</div>
                                <div className="text-sm text-muted-foreground truncate mt-1">
                                    {ws.description || "설명 없음"}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {selectedId && (
                <>
                    <Separator />

                    {/* 헤더 */}
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium">속성 목록</h3>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setTemplateOpen(true)} size="sm">
                                <LayoutTemplate className="h-4 w-4 mr-1" />
                                템플릿으로 시작
                            </Button>
                            <Button onClick={() => setCreateOpen(true)} size="sm">
                                <Plus className="h-4 w-4 mr-1" />
                                속성 추가
                            </Button>
                        </div>
                    </div>

                    {/* 필드 테이블 */}
                    {fieldsLoading ? (
                        <div className="text-muted-foreground py-4 text-center">로딩 중...</div>
                    ) : fields.length === 0 ? (
                        <div className="text-muted-foreground py-8 text-center">
                            등록된 속성이 없습니다.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[70px]">순서</TableHead>
                                        <TableHead>라벨</TableHead>
                                        <TableHead>key</TableHead>
                                        <TableHead>타입</TableHead>
                                        <TableHead className="w-[60px]">필수</TableHead>
                                        <TableHead className="w-[60px]">카테고리</TableHead>
                                        <TableHead className="w-[90px]">작업</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {fields.map((field, index) => (
                                        <TableRow key={field.id}>
                                            <TableCell>
                                                <div className="flex flex-col gap-0.5">
                                                    <button
                                                        type="button"
                                                        className="p-0.5 hover:bg-accent rounded disabled:opacity-30"
                                                        disabled={index === 0}
                                                        onClick={() => handleMoveUp(index)}
                                                    >
                                                        <ChevronUp className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="p-0.5 hover:bg-accent rounded disabled:opacity-30"
                                                        disabled={index === fields.length - 1}
                                                        onClick={() => handleMoveDown(index)}
                                                    >
                                                        <ChevronDown className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {field.label}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm font-mono">
                                                {field.key}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="secondary">
                                                    {FIELD_TYPE_LABELS[field.fieldType] || field.fieldType}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                {!!field.isRequired && (
                                                    <span className="text-destructive font-bold">*</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {field.category || "-"}
                                            </TableCell>
                                            <TableCell>
                                                {field.isSystem ? (
                                                    <Lock className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <div className="flex gap-1">
                                                        <button
                                                            type="button"
                                                            className="p-1 hover:bg-accent rounded"
                                                            onClick={() => handleEdit(field)}
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            className="p-1 hover:bg-destructive/10 rounded text-destructive"
                                                            onClick={() => handleDelete(field)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </>
            )}

            <CreateFieldDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSubmit={createField}
            />
            <EditFieldDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                field={editTarget}
                onSubmit={updateField}
            />
            <DeleteFieldDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                field={deleteTarget}
                onConfirm={deleteField}
            />
            <TemplatePickerDialog
                open={templateOpen}
                onOpenChange={setTemplateOpen}
                onSelect={handleApplyTemplate}
                isApplying={isApplying}
            />
        </div>
    );
}
