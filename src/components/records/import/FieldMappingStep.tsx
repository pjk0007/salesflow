"use client";

import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { FieldDefinition } from "@/types";

interface FieldMappingStepProps {
    csvHeaders: string[];
    mapping: Record<string, string>;
    onMappingChange: (mapping: Record<string, string>) => void;
    mappableFields: FieldDefinition[];
    duplicateAction: "skip" | "error";
    onDuplicateActionChange: (action: "skip" | "error") => void;
    duplicateCheckField?: string;
}

export default function FieldMappingStep({
    csvHeaders,
    mapping,
    onMappingChange,
    mappableFields,
    duplicateAction,
    onDuplicateActionChange,
    duplicateCheckField,
}: FieldMappingStepProps) {
    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                CSV 헤더를 필드에 매핑하세요. 매핑하지 않은 컬럼은 무시됩니다.
            </p>
            <div className="max-h-[400px] overflow-y-auto space-y-2">
                {csvHeaders.map(header => (
                    <div key={header} className="flex items-center gap-3">
                        <span className="w-[200px] text-sm font-medium truncate" title={header}>
                            {header}
                        </span>
                        <span className="text-muted-foreground">&rarr;</span>
                        <Select
                            value={mapping[header] || "__skip__"}
                            onValueChange={(v) =>
                                onMappingChange({
                                    ...mapping,
                                    [header]: v === "__skip__" ? "" : v,
                                })
                            }
                        >
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="건너뛰기" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__skip__">건너뛰기</SelectItem>
                                {mappableFields.map(f => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.label} ({f.fieldType})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {mapping[header] && <Badge variant="secondary">매핑됨</Badge>}
                    </div>
                ))}
            </div>
            <div className="border-t pt-4 space-y-2">
                <Label>중복 처리</Label>
                <Select
                    value={duplicateAction}
                    onValueChange={(v) => onDuplicateActionChange(v as "skip" | "error")}
                >
                    <SelectTrigger className="w-[200px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="skip">건너뛰기</SelectItem>
                        <SelectItem value="error">에러 표시</SelectItem>
                    </SelectContent>
                </Select>
                {duplicateCheckField && (
                    <p className="text-xs text-muted-foreground">
                        중복 기준 필드: {duplicateCheckField}
                    </p>
                )}
            </div>
        </div>
    );
}
