"use client";

import { useState, useMemo } from "react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Plus, Pencil, Trash2, Lock, ArrowUpDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFieldTypes } from "@/hooks/useFieldTypes";
import { useFieldTypeManagement } from "@/hooks/useFieldTypeManagement";
import CreateFieldDialog from "./CreateFieldDialog";
import EditFieldDialog from "./EditFieldDialog";
import DeleteFieldDialog from "./DeleteFieldDialog";
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

function SortableFieldRow({
    field,
    onEdit,
    onDelete,
}: {
    field: FieldDefinition;
    onEdit: (field: FieldDefinition) => void;
    onDelete: (field: FieldDefinition) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
        useSortable({ id: field.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <TableRow ref={setNodeRef} style={style}>
            <TableCell className="w-10">
                <button
                    type="button"
                    className="cursor-grab active:cursor-grabbing p-1 hover:bg-accent rounded"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                </button>
            </TableCell>
            <TableCell className="font-medium">{field.label}</TableCell>
            <TableCell className="text-muted-foreground text-sm font-mono">{field.key}</TableCell>
            <TableCell>
                <Badge variant="secondary">
                    {FIELD_TYPE_LABELS[field.fieldType] || field.fieldType}
                </Badge>
            </TableCell>
            <TableCell>
                {!!field.isRequired && <span className="text-destructive font-bold">*</span>}
            </TableCell>
            <TableCell>
                {!!field.isSortable && <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </TableCell>
            <TableCell>
                {field.isSystem ? (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                    <div className="flex gap-1">
                        <button type="button" className="p-1 hover:bg-accent rounded" onClick={() => onEdit(field)}>
                            <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" className="p-1 hover:bg-destructive/10 rounded text-destructive" onClick={() => onDelete(field)}>
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                )}
            </TableCell>
        </TableRow>
    );
}

export default function FieldTypeManagementTab() {
    const { fieldTypes: types, createType, deleteType } = useFieldTypes();
    const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
    const { fields, reorderFields, createField, updateField, deleteField } = useFieldTypeManagement(selectedTypeId);

    const [createTypeOpen, setCreateTypeOpen] = useState(false);
    const [newTypeName, setNewTypeName] = useState("");
    const [newTypeDesc, setNewTypeDesc] = useState("");
    const [creatingType, setCreatingType] = useState(false);

    const [createFieldOpen, setCreateFieldOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<FieldDefinition | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string; key: string } | null>(null);

    // 첫 타입 자동 선택
    const selectedType = useMemo(() => {
        if (types.length > 0 && selectedTypeId === null) {
            setSelectedTypeId(types[0].id);
        }
        return types.find((t) => t.id === selectedTypeId);
    }, [types, selectedTypeId]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = fields.findIndex((f) => f.id === active.id);
        const newIndex = fields.findIndex((f) => f.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(fields, oldIndex, newIndex);
        await reorderFields(reordered.map((f) => f.id));
    };

    const handleCreateType = async () => {
        if (!newTypeName.trim()) return;
        setCreatingType(true);
        const result = await createType({ name: newTypeName.trim(), description: newTypeDesc.trim() || undefined });
        if (result.success) {
            toast.success("속성 타입이 생성되었습니다.");
            setSelectedTypeId(result.data.id);
            setCreateTypeOpen(false);
            setNewTypeName("");
            setNewTypeDesc("");
        } else {
            toast.error(result.error || "생성에 실패했습니다.");
        }
        setCreatingType(false);
    };

    const handleDeleteType = async () => {
        if (!selectedTypeId) return;
        const result = await deleteType(selectedTypeId);
        if (result.success) {
            toast.success("속성 타입이 삭제되었습니다.");
            setSelectedTypeId(null);
        } else {
            toast.error(result.error || "삭제에 실패했습니다.");
        }
    };

    const handleEdit = (field: FieldDefinition) => {
        setEditTarget(field);
        setEditOpen(true);
    };

    const handleDelete = (field: FieldDefinition) => {
        setDeleteTarget({ id: field.id, label: field.label, key: field.key });
        setDeleteOpen(true);
    };

    return (
        <div className="space-y-6">
            {/* 타입 목록 */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <Label>속성 타입 목록</Label>
                    <Button size="sm" onClick={() => setCreateTypeOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" /> 타입 추가
                    </Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {types.map((type) => (
                        <Card
                            key={type.id}
                            className={cn(
                                "cursor-pointer hover:border-primary/50 transition-colors",
                                selectedTypeId === type.id && "border-primary ring-1 ring-primary"
                            )}
                            onClick={() => setSelectedTypeId(type.id)}
                        >
                            <CardContent className="p-4">
                                <div className="font-medium truncate">{type.name}</div>
                                <div className="text-sm text-muted-foreground truncate mt-1">
                                    {type.description || "설명 없음"}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>

            {selectedType && (
                <>
                    <Separator />

                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-medium">&quot;{selectedType.name}&quot; 속성 목록</h3>
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                이 타입의 속성을 변경하면 사용 중인 모든 워크스페이스에 영향을 줍니다.
                            </p>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={() => setCreateFieldOpen(true)}>
                                <Plus className="h-4 w-4 mr-1" /> 속성 추가
                            </Button>
                        </div>
                    </div>

                    {fields.length === 0 ? (
                        <div className="text-muted-foreground py-8 text-center">
                            등록된 속성이 없습니다.
                        </div>
                    ) : (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[40px]" />
                                            <TableHead>라벨</TableHead>
                                            <TableHead>key</TableHead>
                                            <TableHead>타입</TableHead>
                                            <TableHead className="w-[60px]">필수</TableHead>
                                            <TableHead className="w-[60px]">정렬</TableHead>
                                            <TableHead className="w-[90px]">작업</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                                            {fields.map((field) => (
                                                <SortableFieldRow
                                                    key={field.id}
                                                    field={field}
                                                    onEdit={handleEdit}
                                                    onDelete={handleDelete}
                                                />
                                            ))}
                                        </SortableContext>
                                    </TableBody>
                                </Table>
                            </div>
                        </DndContext>
                    )}
                </>
            )}

            {/* 타입 생성 다이얼로그 */}
            <Dialog open={createTypeOpen} onOpenChange={setCreateTypeOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>속성 타입 생성</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-1.5">
                            <Label>타입 이름 <span className="text-destructive">*</span></Label>
                            <Input
                                value={newTypeName}
                                onChange={(e) => setNewTypeName(e.target.value)}
                                placeholder="예: 기업 CRM"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>설명</Label>
                            <Input
                                value={newTypeDesc}
                                onChange={(e) => setNewTypeDesc(e.target.value)}
                                placeholder="타입 설명 (선택)"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateTypeOpen(false)} disabled={creatingType}>취소</Button>
                        <Button onClick={handleCreateType} disabled={creatingType || !newTypeName.trim()}>
                            {creatingType ? "생성 중..." : "생성"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 필드 CRUD 다이얼로그 */}
            <CreateFieldDialog
                open={createFieldOpen}
                onOpenChange={setCreateFieldOpen}
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
        </div>
    );
}
