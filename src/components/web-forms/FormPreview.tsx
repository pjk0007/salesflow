import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { FormFieldItem } from "./FormBuilder";

interface FormPreviewProps {
    title: string;
    description: string;
    fields: FormFieldItem[];
}

export default function FormPreview({ title, description, fields }: FormPreviewProps) {
    return (
        <div className="border rounded-lg p-6 bg-background max-w-md mx-auto">
            <div className="mb-6">
                <h2 className="text-xl font-bold">{title || "폼 제목"}</h2>
                {description && (
                    <p className="text-sm text-muted-foreground mt-1">{description}</p>
                )}
            </div>

            <div className="space-y-4">
                {fields.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                        왼쪽에서 필드를 추가하세요
                    </p>
                )}
                {fields.map((field) => (
                    <div key={field.tempId} className="space-y-1.5">
                        <label className="text-sm font-medium">
                            {field.label || "필드 이름"}
                            {field.isRequired && (
                                <span className="text-destructive ml-1">*</span>
                            )}
                        </label>
                        {field.description && (
                            <p className="text-xs text-muted-foreground">
                                {field.description}
                            </p>
                        )}
                        {renderFieldInput(field)}
                    </div>
                ))}
            </div>

            {fields.length > 0 && (
                <Button className="w-full mt-6" disabled>
                    제출
                </Button>
            )}
        </div>
    );
}

function renderFieldInput(field: FormFieldItem) {
    switch (field.fieldType) {
        case "textarea":
            return (
                <Textarea
                    placeholder={field.placeholder || ""}
                    disabled
                    rows={3}
                />
            );
        case "select":
            return (
                <Select disabled>
                    <SelectTrigger>
                        <SelectValue placeholder={field.placeholder || "선택"} />
                    </SelectTrigger>
                    <SelectContent>
                        {field.options.map((opt, i) => (
                            <SelectItem key={i} value={opt || `opt-${i}`}>
                                {opt || "(빈 옵션)"}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        case "checkbox":
            return (
                <div className="flex items-center gap-2">
                    <Checkbox disabled />
                    <span className="text-sm">{field.placeholder || "동의합니다"}</span>
                </div>
            );
        case "date":
            return <Input type="date" disabled />;
        default:
            return (
                <Input
                    type={field.fieldType === "email" ? "email" : "text"}
                    placeholder={field.placeholder || ""}
                    disabled
                />
            );
    }
}
