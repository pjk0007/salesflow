import { Building2, UserRound, Home, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TEMPLATES } from "@/lib/field-templates";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
    Building2,
    UserRound,
    Home,
    Users,
};

interface FieldsStepProps {
    selectedTemplateId: string | null;
    onSelect: (templateId: string | null) => void;
}

export default function FieldsStep({ selectedTemplateId, onSelect }: FieldsStepProps) {
    return (
        <div className="space-y-6 text-center">
            <div>
                <h2 className="text-2xl font-bold">어떤 데이터를 관리하시나요?</h2>
                <p className="mt-2 text-muted-foreground">
                    템플릿을 선택하면 기본 필드가 자동으로 설정됩니다.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {FIELD_TEMPLATES.map((template) => {
                    const Icon = ICON_MAP[template.icon] ?? Building2;
                    const isSelected = selectedTemplateId === template.id;
                    return (
                        <button
                            key={template.id}
                            type="button"
                            onClick={() => onSelect(isSelected ? null : template.id)}
                            className={cn(
                                "flex flex-col items-center gap-2 rounded-lg border p-4 text-left transition hover:shadow-md",
                                isSelected ? "border-primary ring-2 ring-primary" : ""
                            )}
                        >
                            <Icon className="h-8 w-8 text-primary" />
                            <span className="font-medium">{template.name}</span>
                            <span className="text-xs text-muted-foreground text-center">
                                {template.description}
                            </span>
                        </button>
                    );
                })}
            </div>

            <button
                type="button"
                onClick={() => onSelect(null)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
                직접 설정할게요 (건너뛰기)
            </button>
        </div>
    );
}
