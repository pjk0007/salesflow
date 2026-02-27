import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { FieldDefinition } from "@/types";

interface TriggerCondition {
    field?: string;
    operator?: "eq" | "ne" | "contains";
    value?: string;
}

interface TriggerConditionFormProps {
    fields: FieldDefinition[];
    value: TriggerCondition | null;
    onChange: (condition: TriggerCondition | null) => void;
}

const OPERATOR_OPTIONS = [
    { value: "eq", label: "같음 (=)" },
    { value: "ne", label: "다름 (≠)" },
    { value: "contains", label: "포함" },
];

export default function TriggerConditionForm({
    fields,
    value,
    onChange,
}: TriggerConditionFormProps) {
    const isAlways = !value || !value.field;

    const handleAlwaysChange = (checked: boolean) => {
        if (checked) {
            onChange(null);
        } else {
            onChange({ field: "", operator: "eq", value: "" });
        }
    };

    return (
        <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">발송 조건</Label>
                <div className="flex items-center gap-2">
                    <Checkbox
                        id="always-trigger"
                        checked={isAlways}
                        onCheckedChange={handleAlwaysChange}
                    />
                    <label htmlFor="always-trigger" className="text-xs text-muted-foreground cursor-pointer">
                        조건 없이 항상 발송
                    </label>
                </div>
            </div>

            {!isAlways && (
                <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                        <Select
                            value={value?.field || ""}
                            onValueChange={(f) => onChange({ ...value, field: f })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="필드" />
                            </SelectTrigger>
                            <SelectContent>
                                {fields.map((f) => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select
                            value={value?.operator || "eq"}
                            onValueChange={(op) =>
                                onChange({ ...value, operator: op as "eq" | "ne" | "contains" })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {OPERATOR_OPTIONS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                        {op.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Input
                            value={value?.value || ""}
                            onChange={(e) => onChange({ ...value, value: e.target.value })}
                            placeholder="값"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
