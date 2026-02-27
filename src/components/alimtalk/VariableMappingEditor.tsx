import { useMemo } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { FieldDefinition } from "@/types";

interface VariableMappingEditorProps {
    templateContent: string;
    fields: FieldDefinition[];
    value: Record<string, string>;
    onChange: (mappings: Record<string, string>) => void;
}

export default function VariableMappingEditor({
    templateContent,
    fields,
    value,
    onChange,
}: VariableMappingEditorProps) {
    const variables = useMemo(() => {
        const matches = templateContent.match(/#\{([^}]+)\}/g);
        if (!matches) return [];
        return [...new Set(matches)];
    }, [templateContent]);

    if (variables.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                이 템플릿에는 치환 변수가 없습니다.
            </p>
        );
    }

    const handleChange = (variable: string, fieldKey: string) => {
        onChange({ ...value, [variable]: fieldKey });
    };

    return (
        <div className="space-y-3">
            <Label>변수 매핑</Label>
            <p className="text-xs text-muted-foreground">
                템플릿 변수를 레코드 필드에 매핑해주세요.
            </p>
            <div className="space-y-2">
                {variables.map((variable) => (
                    <div key={variable} className="flex items-center gap-3">
                        <span className="text-sm font-mono bg-yellow-50 border border-yellow-200 px-2 py-1 rounded min-w-[120px] text-center">
                            {variable}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <Select
                            value={value[variable] || ""}
                            onValueChange={(v) => handleChange(variable, v)}
                        >
                            <SelectTrigger className="flex-1">
                                <SelectValue placeholder="필드 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {fields.map((field) => (
                                    <SelectItem key={field.key} value={field.key}>
                                        {field.label} ({field.key})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ))}
            </div>
        </div>
    );
}
