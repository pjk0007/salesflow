import { useState } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Filter, Plus, X } from "lucide-react";
import type { FieldDefinition, FilterCondition, FilterOperator } from "@/types";

// 필드 타입별 연산자 맵
const OPERATORS_BY_TYPE: Record<string, { value: FilterOperator; label: string }[]> = {
    text: [
        { value: "contains", label: "포함" },
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    number: [
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "gt", label: ">" },
        { value: "gte", label: ">=" },
        { value: "lt", label: "<" },
        { value: "lte", label: "<=" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    date: [
        { value: "equals", label: "같음" },
        { value: "before", label: "이전" },
        { value: "after", label: "이후" },
        { value: "between", label: "사이" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    select: [
        { value: "equals", label: "같음" },
        { value: "not_equals", label: "같지 않음" },
        { value: "is_empty", label: "비어있음" },
        { value: "is_not_empty", label: "비어있지 않음" },
    ],
    checkbox: [
        { value: "is_true", label: "체크됨" },
        { value: "is_false", label: "체크 안됨" },
    ],
};

function getOperatorGroup(fieldType: string): string {
    if (["text", "textarea", "phone", "email"].includes(fieldType)) return "text";
    if (["number", "currency"].includes(fieldType)) return "number";
    if (["date", "datetime"].includes(fieldType)) return "date";
    if (["select", "user_select"].includes(fieldType)) return "select";
    if (fieldType === "checkbox") return "checkbox";
    return "text";
}

const NO_VALUE_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty", "is_true", "is_false"];

interface FilterBuilderProps {
    fields: FieldDefinition[];
    filters: FilterCondition[];
    onFiltersChange: (filters: FilterCondition[]) => void;
}

export default function FilterBuilder({
    fields,
    filters,
    onFiltersChange,
}: FilterBuilderProps) {
    const [draft, setDraft] = useState<FilterCondition[]>(filters);
    const [open, setOpen] = useState(false);

    const handleOpenChange = (isOpen: boolean) => {
        if (isOpen) {
            setDraft(
                filters.length > 0
                    ? [...filters]
                    : [{ field: "", operator: "contains", value: null }]
            );
        }
        setOpen(isOpen);
    };

    const addCondition = () => {
        if (draft.length >= 10) return;
        setDraft([...draft, { field: "", operator: "contains", value: null }]);
    };

    const removeCondition = (index: number) => {
        setDraft(draft.filter((_, i) => i !== index));
    };

    const updateCondition = (index: number, patch: Partial<FilterCondition>) => {
        setDraft(draft.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    };

    const handleFieldChange = (index: number, fieldKey: string) => {
        const field = fields.find((f) => f.key === fieldKey);
        const group = field ? getOperatorGroup(field.fieldType) : "text";
        const defaultOp = OPERATORS_BY_TYPE[group][0].value;
        updateCondition(index, {
            field: fieldKey,
            operator: defaultOp,
            value: null,
            valueTo: undefined,
        });
    };

    const handleApply = () => {
        const valid = draft.filter((c) => c.field !== "");
        onFiltersChange(valid);
        setOpen(false);
    };

    const handleReset = () => {
        setDraft([]);
        onFiltersChange([]);
        setOpen(false);
    };

    const renderValueInput = (condition: FilterCondition, index: number) => {
        if (NO_VALUE_OPERATORS.includes(condition.operator)) return null;

        const field = fields.find((f) => f.key === condition.field);
        if (!field) return null;

        const group = getOperatorGroup(field.fieldType);

        if (group === "select" && field.options) {
            return (
                <Select
                    value={condition.value ? String(condition.value) : ""}
                    onValueChange={(v) => updateCondition(index, { value: v })}
                >
                    <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {field.options.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                                {opt}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            );
        }

        if (condition.operator === "between") {
            return (
                <div className="flex items-center gap-1 flex-1">
                    <Input
                        type="date"
                        className="h-8 text-xs"
                        value={condition.value ? String(condition.value) : ""}
                        onChange={(e) =>
                            updateCondition(index, { value: e.target.value })
                        }
                    />
                    <span className="text-xs text-muted-foreground">~</span>
                    <Input
                        type="date"
                        className="h-8 text-xs"
                        value={condition.valueTo ? String(condition.valueTo) : ""}
                        onChange={(e) =>
                            updateCondition(index, { valueTo: e.target.value })
                        }
                    />
                </div>
            );
        }

        if (group === "date") {
            return (
                <Input
                    type="date"
                    className="h-8 flex-1 text-xs"
                    value={condition.value ? String(condition.value) : ""}
                    onChange={(e) =>
                        updateCondition(index, { value: e.target.value })
                    }
                />
            );
        }

        if (group === "number") {
            return (
                <Input
                    type="number"
                    className="h-8 flex-1"
                    placeholder="값"
                    value={condition.value !== null ? String(condition.value) : ""}
                    onChange={(e) =>
                        updateCondition(index, {
                            value: e.target.value ? Number(e.target.value) : null,
                        })
                    }
                />
            );
        }

        // text
        return (
            <Input
                className="h-8 flex-1"
                placeholder="값"
                value={condition.value !== null ? String(condition.value) : ""}
                onChange={(e) =>
                    updateCondition(index, { value: e.target.value || null })
                }
            />
        );
    };

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <Filter className="h-4 w-4" />
                    필터
                    {filters.length > 0 && (
                        <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                            {filters.length}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[520px] p-4" align="start">
                <p className="text-sm font-medium mb-3">필터 조건</p>

                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {draft.map((condition, index) => {
                        const field = fields.find(
                            (f) => f.key === condition.field
                        );
                        const group = field
                            ? getOperatorGroup(field.fieldType)
                            : "text";
                        const operators = OPERATORS_BY_TYPE[group] ?? OPERATORS_BY_TYPE.text;

                        return (
                            <div
                                key={index}
                                className="flex items-center gap-2"
                            >
                                <Select
                                    value={condition.field}
                                    onValueChange={(v) =>
                                        handleFieldChange(index, v)
                                    }
                                >
                                    <SelectTrigger className="h-8 w-[140px]">
                                        <SelectValue placeholder="필드" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {fields
                                            .filter((f) => !["file", "formula"].includes(f.fieldType))
                                            .map((f) => (
                                                <SelectItem
                                                    key={f.key}
                                                    value={f.key}
                                                >
                                                    {f.label}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>

                                <Select
                                    value={condition.operator}
                                    onValueChange={(v) =>
                                        updateCondition(index, {
                                            operator: v as FilterOperator,
                                            value: NO_VALUE_OPERATORS.includes(v as FilterOperator) ? null : condition.value,
                                        })
                                    }
                                >
                                    <SelectTrigger className="h-8 w-[100px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operators.map((op) => (
                                            <SelectItem
                                                key={op.value}
                                                value={op.value}
                                            >
                                                {op.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                {renderValueInput(condition, index)}

                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 shrink-0"
                                    onClick={() => removeCondition(index)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        );
                    })}
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 gap-1.5"
                    onClick={addCondition}
                    disabled={draft.length >= 10}
                >
                    <Plus className="h-4 w-4" />
                    조건 추가
                </Button>

                <div className="flex justify-between pt-3 mt-3 border-t">
                    <Button variant="ghost" size="sm" onClick={handleReset}>
                        초기화
                    </Button>
                    <Button size="sm" onClick={handleApply}>
                        적용
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
