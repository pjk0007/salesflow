import { useState } from "react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { CreateFieldInput, FieldType } from "@/types";

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
    { value: "text", label: "텍스트" },
    { value: "number", label: "숫자" },
    { value: "currency", label: "금액" },
    { value: "date", label: "날짜" },
    { value: "datetime", label: "날짜+시간" },
    { value: "select", label: "선택" },
    { value: "phone", label: "전화번호" },
    { value: "email", label: "이메일" },
    { value: "textarea", label: "장문 텍스트" },
    { value: "checkbox", label: "체크박스" },
];

interface CreateFieldDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: CreateFieldInput) => Promise<{ success: boolean; error?: string }>;
}

export default function CreateFieldDialog({
    open,
    onOpenChange,
    onSubmit,
}: CreateFieldDialogProps) {
    const [key, setKey] = useState("");
    const [label, setLabel] = useState("");
    const [fieldType, setFieldType] = useState<FieldType>("text");
    const [category, setCategory] = useState("");
    const [isRequired, setIsRequired] = useState(false);
    const [options, setOptions] = useState<string[]>([]);
    const [newOption, setNewOption] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const resetForm = () => {
        setKey("");
        setLabel("");
        setFieldType("text");
        setCategory("");
        setIsRequired(false);
        setOptions([]);
        setNewOption("");
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) resetForm();
        onOpenChange(open);
    };

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
        if (isSubmitting) return;
        if (!key.trim()) {
            toast.error("key를 입력해주세요.");
            return;
        }
        if (!label.trim()) {
            toast.error("라벨을 입력해주세요.");
            return;
        }
        if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key.trim())) {
            toast.error("key는 영문으로 시작하고 영문과 숫자만 사용 가능합니다.");
            return;
        }
        if (fieldType === "select" && options.length === 0) {
            toast.error("선택 타입은 옵션을 1개 이상 추가해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit({
                key: key.trim(),
                label: label.trim(),
                fieldType,
                category: category.trim() || undefined,
                isRequired,
                options: fieldType === "select" ? options : undefined,
            });
            if (result.success) {
                toast.success("속성이 추가되었습니다.");
                resetForm();
                onOpenChange(false);
            } else {
                toast.error(result.error || "추가에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md">
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <DialogHeader>
                        <DialogTitle>새 속성 추가</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-1.5">
                            <Label>
                                Key (영문) <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                value={key}
                                onChange={(e) => setKey(e.target.value)}
                                placeholder="예: customerType"
                                autoFocus
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>
                                라벨 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="예: 고객 유형"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>
                                타입 <span className="text-destructive">*</span>
                            </Label>
                            <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FIELD_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label>카테고리</Label>
                            <Input
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                placeholder="예: 고객정보"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="isRequired"
                                checked={isRequired}
                                onCheckedChange={(checked) => setIsRequired(checked === true)}
                            />
                            <Label htmlFor="isRequired" className="cursor-pointer">
                                필수 항목
                            </Label>
                        </div>

                        {fieldType === "select" && (
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
                            onClick={() => handleOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "추가 중..." : "추가"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
