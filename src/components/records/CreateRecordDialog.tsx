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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFields } from "@/hooks/useFields";
import { toast } from "sonner";

interface CreateRecordDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspaceId: number;
    onSubmit: (data: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}

export default function CreateRecordDialog({
    open,
    onOpenChange,
    workspaceId,
    onSubmit,
}: CreateRecordDialogProps) {
    const { fields } = useFields(workspaceId);
    const [formData, setFormData] = useState<Record<string, unknown>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const editableFields = fields.filter(
        (f) => f.fieldType !== "formula" && f.cellType !== "readonly"
    );

    const setValue = (key: string, value: unknown) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        for (const field of editableFields) {
            if (field.isRequired) {
                const val = formData[field.key];
                if (val === undefined || val === null || val === "") {
                    newErrors[field.key] = `${field.label}은(는) 필수 항목입니다.`;
                }
            }
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) return;

        setIsSubmitting(true);
        try {
            const result = await onSubmit(formData);
            if (result.success) {
                toast.success("레코드가 등록되었습니다.");
                setFormData({});
                setErrors({});
                onOpenChange(false);
            } else {
                toast.error(result.error || "등록에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setFormData({});
            setErrors({});
        }
        onOpenChange(open);
    };

    const renderField = (field: typeof editableFields[number]) => {
        const value = formData[field.key];

        switch (field.fieldType) {
            case "textarea":
                return (
                    <Textarea
                        value={String(value ?? "")}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        placeholder={field.label}
                        rows={3}
                    />
                );

            case "select":
                return (
                    <Select
                        value={String(value ?? "")}
                        onValueChange={(v) => setValue(field.key, v)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder={`${field.label} 선택`} />
                        </SelectTrigger>
                        <SelectContent>
                            {field.options?.map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                    {opt}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                );

            case "checkbox":
                return (
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={Boolean(value)}
                            onCheckedChange={(checked) => setValue(field.key, checked)}
                        />
                        <span className="text-sm">{field.label}</span>
                    </div>
                );

            case "number":
            case "currency":
                return (
                    <Input
                        type="number"
                        value={String(value ?? "")}
                        onChange={(e) => setValue(field.key, e.target.value ? Number(e.target.value) : "")}
                        placeholder={field.label}
                    />
                );

            case "date":
                return (
                    <Input
                        type="date"
                        value={String(value ?? "")}
                        onChange={(e) => setValue(field.key, e.target.value)}
                    />
                );

            case "datetime":
                return (
                    <Input
                        type="datetime-local"
                        value={String(value ?? "")}
                        onChange={(e) => setValue(field.key, e.target.value)}
                    />
                );

            default:
                return (
                    <Input
                        type={field.fieldType === "email" ? "email" : field.fieldType === "phone" ? "tel" : "text"}
                        value={String(value ?? "")}
                        onChange={(e) => setValue(field.key, e.target.value)}
                        placeholder={field.label}
                    />
                );
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>새 레코드 등록</DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                    <div className="space-y-4 px-1">
                        {editableFields.map((field) => (
                            <div key={field.key} className="space-y-1.5">
                                {field.fieldType !== "checkbox" && (
                                    <Label>
                                        {field.label}
                                        {!!field.isRequired && (
                                            <span className="text-destructive ml-1">*</span>
                                        )}
                                    </Label>
                                )}
                                {renderField(field)}
                                {errors[field.key] && (
                                    <p className="text-sm text-destructive">
                                        {errors[field.key]}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </ScrollArea>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? "등록 중..." : "등록"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
