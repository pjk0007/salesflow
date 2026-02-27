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
import { X } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefinition, UpdateFieldInput } from "@/types";

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
    const [newOption, setNewOption] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (open && field) {
            setLabel(field.label);
            setCategory(field.category ?? "");
            setDefaultWidth(field.defaultWidth);
            setIsRequired(!!field.isRequired);
            setOptions(field.options ?? []);
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
                defaultWidth,
                options: field.fieldType === "select" ? options : undefined,
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
            <DialogContent className="max-w-md">
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

                        {field.fieldType === "select" && (
                            <div className="space-y-2">
                                <Label>옵션</Label>
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
                                                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-sm"
                                            >
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
