import { useState, useCallback } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GripVertical, Plus, X, Trash2 } from "lucide-react";
import type { FieldDefinition } from "@/types";

export interface FormFieldItem {
    tempId: string;
    label: string;
    description: string;
    placeholder: string;
    fieldType: string;
    linkedFieldKey: string;
    isRequired: boolean;
    options: string[];
}

interface FormBuilderProps {
    name: string;
    onNameChange: (name: string) => void;
    title: string;
    onTitleChange: (title: string) => void;
    description: string;
    onDescriptionChange: (desc: string) => void;
    completionTitle: string;
    onCompletionTitleChange: (title: string) => void;
    completionMessage: string;
    onCompletionMessageChange: (msg: string) => void;
    completionButtonText: string;
    onCompletionButtonTextChange: (text: string) => void;
    completionButtonUrl: string;
    onCompletionButtonUrlChange: (url: string) => void;
    defaultValues: { field: string; value: string }[];
    onDefaultValuesChange: (dv: { field: string; value: string }[]) => void;
    fields: FormFieldItem[];
    onFieldsChange: (fields: FormFieldItem[]) => void;
    workspaceFields: FieldDefinition[];
    slug?: string;
}

const FIELD_TYPES = [
    { value: "text", label: "텍스트" },
    { value: "email", label: "이메일" },
    { value: "phone", label: "전화번호" },
    { value: "textarea", label: "긴 텍스트" },
    { value: "select", label: "선택" },
    { value: "checkbox", label: "체크박스" },
    { value: "date", label: "날짜" },
];

function SortableFieldItem({
    field,
    index,
    onUpdate,
    onRemove,
    workspaceFields,
}: {
    field: FormFieldItem;
    index: number;
    onUpdate: (index: number, field: FormFieldItem) => void;
    onRemove: (index: number) => void;
    workspaceFields: FieldDefinition[];
}) {
    const { attributes, listeners, setNodeRef, transform, transition } =
        useSortable({ id: field.tempId });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="border rounded-lg p-4 bg-background">
            <div className="flex items-start gap-3">
                <button
                    type="button"
                    className="mt-1 cursor-grab text-muted-foreground hover:text-foreground"
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3">
                        <Input
                            value={field.label}
                            onChange={(e) =>
                                onUpdate(index, { ...field, label: e.target.value })
                            }
                            placeholder="필드 이름"
                            className="flex-1"
                        />
                        <Select
                            value={field.fieldType}
                            onValueChange={(v) =>
                                onUpdate(index, { ...field, fieldType: v })
                            }
                        >
                            <SelectTrigger className="w-[130px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {FIELD_TYPES.map((ft) => (
                                    <SelectItem key={ft.value} value={ft.value}>
                                        {ft.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-3">
                        <Select
                            value={field.linkedFieldKey || "_none"}
                            onValueChange={(v) =>
                                onUpdate(index, {
                                    ...field,
                                    linkedFieldKey: v === "_none" ? "" : v,
                                })
                            }
                        >
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder="연결 필드 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="_none">연결 안 함</SelectItem>
                                {workspaceFields.map((wf) => (
                                    <SelectItem key={wf.key} value={wf.key}>
                                        {wf.label} ({wf.key})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={field.isRequired}
                                onCheckedChange={(checked) =>
                                    onUpdate(index, { ...field, isRequired: checked })
                                }
                            />
                            <span className="text-xs text-muted-foreground">필수</span>
                        </div>
                    </div>
                    <Input
                        value={field.placeholder}
                        onChange={(e) =>
                            onUpdate(index, { ...field, placeholder: e.target.value })
                        }
                        placeholder="플레이스홀더 (선택)"
                        className="text-sm"
                    />
                    {field.fieldType === "select" && (
                        <div className="space-y-2">
                            <Label className="text-xs">선택 옵션</Label>
                            {field.options.map((opt, oi) => (
                                <div key={oi} className="flex items-center gap-2">
                                    <Input
                                        value={opt}
                                        onChange={(e) => {
                                            const newOpts = [...field.options];
                                            newOpts[oi] = e.target.value;
                                            onUpdate(index, { ...field, options: newOpts });
                                        }}
                                        className="text-sm"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => {
                                            const newOpts = field.options.filter(
                                                (_, i) => i !== oi
                                            );
                                            onUpdate(index, { ...field, options: newOpts });
                                        }}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    onUpdate(index, {
                                        ...field,
                                        options: [...field.options, ""],
                                    })
                                }
                            >
                                <Plus className="h-3 w-3 mr-1" /> 옵션 추가
                            </Button>
                        </div>
                    )}
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => onRemove(index)}
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

export default function FormBuilder({
    name,
    onNameChange,
    title,
    onTitleChange,
    description,
    onDescriptionChange,
    completionTitle,
    onCompletionTitleChange,
    completionMessage,
    onCompletionMessageChange,
    completionButtonText,
    onCompletionButtonTextChange,
    completionButtonUrl,
    onCompletionButtonUrlChange,
    defaultValues,
    onDefaultValuesChange,
    fields,
    onFieldsChange,
    workspaceFields,
    slug,
}: FormBuilderProps) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;
            if (over && active.id !== over.id) {
                const oldIndex = fields.findIndex((f) => f.tempId === active.id);
                const newIndex = fields.findIndex((f) => f.tempId === over.id);
                onFieldsChange(arrayMove(fields, oldIndex, newIndex));
            }
        },
        [fields, onFieldsChange]
    );

    const addField = useCallback(() => {
        onFieldsChange([
            ...fields,
            {
                tempId: crypto.randomUUID(),
                label: "",
                description: "",
                placeholder: "",
                fieldType: "text",
                linkedFieldKey: "",
                isRequired: false,
                options: [],
            },
        ]);
    }, [fields, onFieldsChange]);

    const updateField = useCallback(
        (index: number, field: FormFieldItem) => {
            const next = [...fields];
            next[index] = field;
            onFieldsChange(next);
        },
        [fields, onFieldsChange]
    );

    const removeField = useCallback(
        (index: number) => {
            onFieldsChange(fields.filter((_, i) => i !== index));
        },
        [fields, onFieldsChange]
    );

    return (
        <Tabs defaultValue="fields" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="fields">질문 편집</TabsTrigger>
                <TabsTrigger value="settings">폼 설정</TabsTrigger>
                <TabsTrigger value="completion">완료 화면</TabsTrigger>
            </TabsList>

            <TabsContent value="fields" className="space-y-4 mt-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={fields.map((f) => f.tempId)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div className="space-y-3">
                            {fields.map((field, idx) => (
                                <SortableFieldItem
                                    key={field.tempId}
                                    field={field}
                                    index={idx}
                                    onUpdate={updateField}
                                    onRemove={removeField}
                                    workspaceFields={workspaceFields}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
                <Button type="button" variant="outline" onClick={addField}>
                    <Plus className="h-4 w-4 mr-1" /> 필드 추가
                </Button>
            </TabsContent>

            <TabsContent value="settings" className="space-y-4 mt-4">
                <div className="space-y-2">
                    <Label>폼 이름 (관리용)</Label>
                    <Input value={name} onChange={(e) => onNameChange(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>폼 제목</Label>
                    <Input value={title} onChange={(e) => onTitleChange(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label>설명</Label>
                    <Textarea
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                        rows={3}
                    />
                </div>
                {slug && (
                    <div className="space-y-2">
                        <Label>공유 링크</Label>
                        <div className="flex items-center gap-2">
                            <Input
                                readOnly
                                value={`${typeof window !== "undefined" ? window.location.origin : ""}/f/${slug}`}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    navigator.clipboard.writeText(
                                        `${window.location.origin}/f/${slug}`
                                    );
                                }}
                            >
                                복사
                            </Button>
                        </div>
                    </div>
                )}
                <div className="space-y-3">
                    <Label>기본값 설정</Label>
                    {defaultValues.map((dv, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <Select
                                value={dv.field || "_none"}
                                onValueChange={(v) => {
                                    const next = [...defaultValues];
                                    next[i] = { ...next[i], field: v === "_none" ? "" : v };
                                    onDefaultValuesChange(next);
                                }}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="_none">선택</SelectItem>
                                    {workspaceFields.map((wf) => (
                                        <SelectItem key={wf.key} value={wf.key}>
                                            {wf.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Input
                                value={dv.value}
                                onChange={(e) => {
                                    const next = [...defaultValues];
                                    next[i] = { ...next[i], value: e.target.value };
                                    onDefaultValuesChange(next);
                                }}
                                placeholder="값"
                                className="flex-1"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() =>
                                    onDefaultValuesChange(
                                        defaultValues.filter((_, idx) => idx !== i)
                                    )
                                }
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            onDefaultValuesChange([
                                ...defaultValues,
                                { field: "", value: "" },
                            ])
                        }
                    >
                        <Plus className="h-3 w-3 mr-1" /> 기본값 추가
                    </Button>
                </div>
            </TabsContent>

            <TabsContent value="completion" className="space-y-4 mt-4">
                <div className="space-y-2">
                    <Label>완료 제목</Label>
                    <Input
                        value={completionTitle}
                        onChange={(e) => onCompletionTitleChange(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label>완료 메시지</Label>
                    <Textarea
                        value={completionMessage}
                        onChange={(e) => onCompletionMessageChange(e.target.value)}
                        rows={4}
                    />
                </div>
                <div className="space-y-2">
                    <Label>버튼 텍스트 (선택)</Label>
                    <Input
                        value={completionButtonText}
                        onChange={(e) => onCompletionButtonTextChange(e.target.value)}
                        placeholder="예: 홈으로 돌아가기"
                    />
                </div>
                <div className="space-y-2">
                    <Label>버튼 URL (선택)</Label>
                    <Input
                        value={completionButtonUrl}
                        onChange={(e) => onCompletionButtonUrlChange(e.target.value)}
                        placeholder="https://..."
                    />
                </div>
            </TabsContent>
        </Tabs>
    );
}
