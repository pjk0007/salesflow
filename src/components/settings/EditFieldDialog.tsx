import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { X, Palette } from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import type { FieldDefinition, UpdateFieldInput } from "@/types";

const OPTION_COLOR_PALETTE = [
    { label: "회색", value: "#9ca3af" },
    { label: "빨강", value: "#ef4444" },
    { label: "주황", value: "#f97316" },
    { label: "노랑", value: "#f59e0b" },
    { label: "초록", value: "#22c55e" },
    { label: "청록", value: "#06b6d4" },
    { label: "파랑", value: "#3b82f6" },
    { label: "남색", value: "#6366f1" },
    { label: "보라", value: "#8b5cf6" },
    { label: "분홍", value: "#ec4899" },
];

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

interface EditFieldDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    field: FieldDefinition | null;
    onSubmit: (id: number, input: UpdateFieldInput) => Promise<{ success: boolean; error?: string }>;
}

export default function EditFieldDialog({
    open,
    onOpenChange,
    field,
    onSubmit,
}: EditFieldDialogProps) {
    const [label, setLabel] = useState("");
    const [category, setCategory] = useState("");
    const [defaultWidth, setDefaultWidth] = useState(120);
    const [isRequired, setIsRequired] = useState(false);
    const [options, setOptions] = useState<string[]>([]);
    const [optionColors, setOptionColors] = useState<Record<string, string>>({});
    const [optionStyle, setOptionStyle] = useState<"pill" | "square">("pill");
    const [newOption, setNewOption] = useState("");
    const [textColor, setTextColor] = useState("");
    const [isGroupable, setIsGroupable] = useState(false);
    const [isSortable, setIsSortable] = useState(false);
    const [defaultValue, setDefaultValue] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (open && field) {
            setLabel(field.label);
            setCategory(field.category ?? "");
            setDefaultWidth(field.defaultWidth);
            setIsRequired(!!field.isRequired);
            setIsSortable(!!field.isSortable);
            setDefaultValue(field.defaultValue ?? "");
            setOptions(field.options ?? []);
            setOptionColors(field.optionColors ?? {});
            setOptionStyle(field.optionStyle ?? "pill");
            setTextColor(field.cellClassName ?? "");
            setIsGroupable(!!field.isGroupable);
            setNewOption("");
        }
    }, [open, field]);

    const addOption = () => {
        const trimmed = newOption.trim();
        if (trimmed && !options.includes(trimmed)) {
            setOptions([...options, trimmed]);
            setNewOption("");
        }
    };

    const removeOption = (index: number) => {
        setOptions(options.filter((_, i) => i !== index));
    };

    const handleSubmit = async () => {
        if (isSubmitting || !field) return;
        if (!label.trim()) {
            toast.error("라벨을 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit(field.id, {
                label: label.trim(),
                category: category.trim() || undefined,
                isRequired,
                isSortable,
                defaultValue: defaultValue.trim() || undefined,
                defaultWidth,
                options: field.fieldType === "select" ? options : undefined,
                optionColors: field.fieldType === "select" ? optionColors : undefined,
                optionStyle: field.fieldType === "select" ? optionStyle : undefined,
                isGroupable: field.fieldType === "select" ? isGroupable : undefined,
                cellClassName: textColor || undefined,
            });
            if (result.success) {
                toast.success("속성이 수정되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "수정에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!field) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <DialogHeader>
                        <DialogTitle>속성 수정</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-1.5">
                            <Label>Key</Label>
                            <Input value={field.key} disabled className="bg-muted" />
                        </div>

                        <div className="space-y-1.5">
                            <Label>타입</Label>
                            <Input
                                value={FIELD_TYPE_LABELS[field.fieldType] || field.fieldType}
                                disabled
                                className="bg-muted"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>
                                라벨 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="라벨"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>카테고리</Label>
                            <Input
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="카테고리"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>기본 너비 (px)</Label>
                            <Input
                                type="number"
                                value={defaultWidth}
                                onChange={(e) => setDefaultWidth(Number(e.target.value) || 120)}
                                min={40}
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="editIsRequired"
                                checked={isRequired}
                                onCheckedChange={(checked) => setIsRequired(checked === true)}
                            />
                            <Label htmlFor="editIsRequired" className="cursor-pointer">
                                필수 항목
                            </Label>
                        </div>

                        <div className="flex items-center justify-between">
                            <Label htmlFor="editIsSortable" className="cursor-pointer">
                                정렬 가능
                            </Label>
                            <Switch
                                id="editIsSortable"
                                checked={isSortable}
                                onCheckedChange={setIsSortable}
                            />
                        </div>

                        {field.fieldType === "select" && (
                            <div className="flex items-center justify-between">
                                <div>
                                    <Label htmlFor="editIsGroupable" className="cursor-pointer">
                                        그룹 기준
                                    </Label>
                                    <p className="text-xs text-muted-foreground">이 필드를 기준으로 레코드를 그룹핑합니다</p>
                                </div>
                                <Switch
                                    id="editIsGroupable"
                                    checked={isGroupable}
                                    onCheckedChange={setIsGroupable}
                                />
                            </div>
                        )}

                        <div className="space-y-1.5">
                            <Label>기본값</Label>
                            {field.fieldType === "select" && options.length > 0 ? (
                                <Select value={defaultValue || "__none__"} onValueChange={(v) => setDefaultValue(v === "__none__" ? "" : v)}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="기본값 선택 (선택사항)" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none__">없음</SelectItem>
                                        {options.map((opt) => (
                                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : field.fieldType === "date" ? (
                                <DatePicker value={defaultValue} onChange={setDefaultValue} />
                            ) : field.fieldType === "datetime" ? (
                                <Input
                                    type="datetime-local"
                                    value={defaultValue}
                                    onChange={(e) => setDefaultValue(e.target.value)}
                                />
                            ) : field.fieldType === "number" || field.fieldType === "currency" ? (
                                <Input
                                    type="number"
                                    value={defaultValue}
                                    onChange={(e) => setDefaultValue(e.target.value)}
                                    placeholder="레코드 생성 시 자동 입력될 값 (선택사항)"
                                />
                            ) : (
                                <Input
                                    value={defaultValue}
                                    onChange={(e) => setDefaultValue(e.target.value)}
                                    placeholder="레코드 생성 시 자동 입력될 값 (선택사항)"
                                />
                            )}
                        </div>

                        {(field.fieldType === "datetime" || field.fieldType === "date") && (
                            <div className="space-y-1.5">
                                <Label>텍스트 색상</Label>
                                <div className="flex items-center gap-2">
                                    {[
                                        { label: "기본", value: "", color: undefined },
                                        { label: "빨강", value: "text-red-500 font-semibold", color: "#ef4444" },
                                        { label: "주황", value: "text-orange-500 font-semibold", color: "#f97316" },
                                        { label: "파랑", value: "text-blue-500 font-semibold", color: "#3b82f6" },
                                        { label: "초록", value: "text-green-500 font-semibold", color: "#22c55e" },
                                        { label: "보라", value: "text-purple-500 font-semibold", color: "#8b5cf6" },
                                    ].map((c) => (
                                        <button
                                            key={c.label}
                                            type="button"
                                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors ${textColor === c.value ? "border-foreground bg-accent" : "border-border hover:bg-muted"}`}
                                            onClick={() => setTextColor(c.value)}
                                        >
                                            {c.color ? (
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                                            ) : (
                                                <span className="h-3 w-3 rounded-full bg-muted-foreground/30" />
                                            )}
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {field.fieldType === "select" && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <Label>옵션</Label>
                                    <div className="flex items-center gap-1 border rounded-md p-0.5">
                                        <button
                                            type="button"
                                            className={`px-2 py-0.5 text-xs rounded transition-colors ${optionStyle === "pill" ? "bg-accent font-medium" : "hover:bg-muted"}`}
                                            onClick={() => setOptionStyle("pill")}
                                        >
                                            <span className="inline-flex items-center rounded-full bg-foreground/15 px-1.5 py-px text-[10px]">둥근</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={`px-2 py-0.5 text-xs rounded transition-colors ${optionStyle === "square" ? "bg-accent font-medium" : "hover:bg-muted"}`}
                                            onClick={() => setOptionStyle("square")}
                                        >
                                            <span className="inline-flex items-center rounded bg-foreground/15 px-1.5 py-px text-[10px]">네모</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        value={newOption}
                                        onChange={(e) => setNewOption(e.target.value)}
                                        placeholder="옵션 입력"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                addOption();
                                            }
                                        }}
                                    />
                                    <Button type="button" variant="outline" onClick={addOption}>
                                        추가
                                    </Button>
                                </div>
                                {options.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {options.map((opt, i) => (
                                            <span
                                                key={i}
                                                className={`inline-flex items-center gap-1 px-2 py-1 text-sm ${optionStyle === "square" ? "rounded" : "rounded-full"}`}
                                                style={{
                                                    backgroundColor: optionColors[opt] || "#6b7280",
                                                    color: "#fff",
                                                }}
                                            >
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <button
                                                            type="button"
                                                            className="shrink-0 rounded-full border border-border hover:scale-110 transition-transform"
                                                            style={{
                                                                width: 14,
                                                                height: 14,
                                                                backgroundColor: optionColors[opt] || "#9ca3af",
                                                            }}
                                                            title="색상 변경"
                                                        />
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-2" align="start">
                                                        <div className="grid grid-cols-5 gap-1.5">
                                                            {OPTION_COLOR_PALETTE.map((c) => (
                                                                <button
                                                                    key={c.value}
                                                                    type="button"
                                                                    className="w-6 h-6 rounded-full border-2 hover:scale-110 transition-transform"
                                                                    style={{
                                                                        backgroundColor: c.value,
                                                                        borderColor: optionColors[opt] === c.value ? "var(--foreground)" : "transparent",
                                                                    }}
                                                                    title={c.label}
                                                                    onClick={() =>
                                                                        setOptionColors((prev) => ({ ...prev, [opt]: c.value }))
                                                                    }
                                                                />
                                                            ))}
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                                {opt}
                                                <button
                                                    type="button"
                                                    onClick={() => removeOption(i)}
                                                    className="text-muted-foreground hover:text-foreground"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "저장 중..." : "저장"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
