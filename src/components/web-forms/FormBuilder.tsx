import { useCallback } from "react";
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
import { GripVertical, Plus, X, Trash2, ImagePlus } from "lucide-react";
import type { FieldDefinition } from "@/types";
import { toast } from "sonner";

const COVER_COLORS = [
    { value: "#1e293b", label: "다크" },
    { value: "#1e40af", label: "블루" },
    { value: "#065f46", label: "그린" },
    { value: "#7c2d12", label: "브라운" },
    { value: "#581c87", label: "퍼플" },
    { value: "#be123c", label: "레드" },
];

export interface FormFieldItem {
    id?: number;
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
    coverImageUrl: string;
    onCoverImageUrlChange: (url: string) => void;
    coverColor: string;
    onCoverColorChange: (color: string) => void;
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

function mapFieldType(dbType: string): string {
    const map: Record<string, string> = {
        text: "text", email: "email", phone: "phone", textarea: "textarea",
        select: "select", checkbox: "checkbox", date: "date",
        number: "text", url: "text",
    };
    return map[dbType] || "text";
}

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
                    aria-label="질문 순서 변경"
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
                        <span className="text-xs text-muted-foreground shrink-0 w-[60px] text-right">
                            {FIELD_TYPES.find((ft) => ft.value === field.fieldType)?.label || field.fieldType}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Select
                            value={field.linkedFieldKey || "_none"}
                            onValueChange={(v) => {
                                const linked = workspaceFields.find((wf) => wf.key === v);
                                const fieldType = linked ? mapFieldType(linked.fieldType) : field.fieldType;
                                onUpdate(index, {
                                    ...field,
                                    linkedFieldKey: v === "_none" ? "" : v,
                                    fieldType,
                                });
                            }}
                        >
                            <SelectTrigger className="min-w-0 flex-1" aria-label="연결 속성">
                                <SelectValue placeholder="연결 속성 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="_none">연결 안 함</SelectItem>
                                {workspaceFields.length === 0 && (
                                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                        파티션에 속성이 없습니다.
                                        워크스페이스 설정에서 속성 타입을 추가해주세요.
                                    </div>
                                )}
                                {workspaceFields.map((wf) => (
                                    <SelectItem key={wf.key} value={wf.key}>
                                        {wf.label} ({FIELD_TYPES.find((ft) => ft.value === mapFieldType(wf.fieldType))?.label || wf.fieldType})
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
                    {!field.linkedFieldKey && (
                        // 연결 속성이 없으면 답이 어디에도 저장되지 않는다 — 저장 전에 알 수 있게 표시 (UX-045)
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            연결 속성이 없어 이 질문의 답은 레코드에 저장되지 않습니다.
                        </p>
                    )}
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
                    aria-label="질문 삭제"
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
    coverImageUrl,
    onCoverImageUrlChange,
    coverColor,
    onCoverColorChange,
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
                    <Label>커버 이미지</Label>
                    <div className="space-y-3">
                        {coverImageUrl ? (
                            <div className="relative w-full h-32 rounded-lg overflow-hidden">
                                <img src={coverImageUrl} alt="커버" className="w-full h-full object-cover" />
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    className="absolute top-2 right-2 h-7 w-7"
                                    onClick={() => onCoverImageUrlChange("")}
                                >
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Input
                                        placeholder="이미지 URL 입력"
                                        value={coverImageUrl}
                                        onChange={(e) => onCoverImageUrlChange(e.target.value)}
                                    />
                                    <label className="cursor-pointer">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                const formData = new FormData();
                                                formData.append("file", file);
                                                // 실패·형식 오류를 조용히 넘기지 않는다 (UX-048)
                                                try {
                                                    const res = await fetch("/api/upload", { method: "POST", body: formData });
                                                    // /api/upload는 { success, data: { url, fileName } }를 돌려준다 — data.url은 없다
                                                    const data = await res.json();
                                                    const url = data.success ? data.data?.url : undefined;
                                                    if (typeof url === "string" && url) onCoverImageUrlChange(url);
                                                    else toast.error(data.error || "이미지를 올리지 못했습니다.");
                                                } catch {
                                                    toast.error("이미지를 올리지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.");
                                                } finally {
                                                    e.target.value = "";
                                                }
                                            }}
                                        />
                                        <div className="flex items-center gap-1 px-3 py-2 border rounded-md text-sm hover:bg-accent">
                                            <ImagePlus className="h-4 w-4" />
                                            업로드
                                        </div>
                                    </label>
                                </div>
                            </div>
                        )}
                        <div>
                            <Label className="text-xs text-muted-foreground">이미지 없을 때 배경 색상</Label>
                            <div className="flex gap-2 mt-1.5">
                                {COVER_COLORS.map((c) => (
                                    <button
                                        key={c.value}
                                        type="button"
                                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                                            coverColor === c.value ? "border-foreground scale-110" : "border-transparent"
                                        }`}
                                        style={{ backgroundColor: c.value }}
                                        title={c.label}
                                        onClick={() => onCoverColorChange(c.value)}
                                    />
                                ))}
                                <button
                                    type="button"
                                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                                        !coverColor ? "border-foreground scale-110" : "border-transparent"
                                    }`}
                                    style={{ background: "linear-gradient(135deg, #ddd 50%, #eee 50%)" }}
                                    title="없음"
                                    onClick={() => onCoverColorChange("")}
                                />
                            </div>
                        </div>
                    </div>
                </div>
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
                                    navigator.clipboard
                                        .writeText(`${window.location.origin}/f/${slug}`)
                                        .then(
                                            () => toast.success("링크가 복사되었습니다."),
                                            () => toast.error("링크를 복사하지 못했습니다. 주소를 직접 선택해 복사해주세요.")
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
