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

interface RepeatConfig {
    intervalHours: number;
    maxRepeat: number;
    stopCondition: {
        field: string;
        operator: "eq" | "ne";
        value: string;
    };
}

interface RepeatConfigFormProps {
    fields: FieldDefinition[];
    value: RepeatConfig | null;
    onChange: (config: RepeatConfig | null) => void;
}

const INTERVAL_OPTIONS = [
    { value: "1", label: "1시간" },
    { value: "2", label: "2시간" },
    { value: "4", label: "4시간" },
    { value: "6", label: "6시간" },
    { value: "12", label: "12시간" },
    { value: "24", label: "1일" },
    { value: "48", label: "2일" },
    { value: "72", label: "3일" },
    { value: "168", label: "7일" },
];

const MAX_REPEAT_OPTIONS = Array.from({ length: 10 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}회`,
}));

export default function RepeatConfigForm({
    fields,
    value,
    onChange,
}: RepeatConfigFormProps) {
    const enabled = value !== null;

    const handleToggle = (checked: boolean) => {
        if (checked) {
            onChange({
                intervalHours: 24,
                maxRepeat: 3,
                stopCondition: { field: "", operator: "eq", value: "" },
            });
        } else {
            onChange(null);
        }
    };

    return (
        <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-2">
                <Checkbox
                    id="repeat-enabled"
                    checked={enabled}
                    onCheckedChange={handleToggle}
                />
                <label htmlFor="repeat-enabled" className="text-sm font-medium cursor-pointer">
                    반복 발송 사용
                </label>
            </div>

            {enabled && value && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <Label className="text-xs">반복 간격</Label>
                            <Select
                                value={String(value.intervalHours)}
                                onValueChange={(v) =>
                                    onChange({ ...value, intervalHours: Number(v) })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {INTERVAL_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1">
                            <Label className="text-xs">최대 횟수</Label>
                            <Select
                                value={String(value.maxRepeat)}
                                onValueChange={(v) =>
                                    onChange({ ...value, maxRepeat: Number(v) })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {MAX_REPEAT_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <Label className="text-xs">중단 조건 (이 조건이 충족되면 반복 중단)</Label>
                        <div className="grid grid-cols-3 gap-2">
                            <Select
                                value={value.stopCondition.field}
                                onValueChange={(f) =>
                                    onChange({
                                        ...value,
                                        stopCondition: { ...value.stopCondition, field: f },
                                    })
                                }
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
                                value={value.stopCondition.operator}
                                onValueChange={(op) =>
                                    onChange({
                                        ...value,
                                        stopCondition: {
                                            ...value.stopCondition,
                                            operator: op as "eq" | "ne",
                                        },
                                    })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="eq">같음 (=)</SelectItem>
                                    <SelectItem value="ne">다름 (≠)</SelectItem>
                                </SelectContent>
                            </Select>

                            <Input
                                value={value.stopCondition.value}
                                onChange={(e) =>
                                    onChange({
                                        ...value,
                                        stopCondition: {
                                            ...value.stopCondition,
                                            value: e.target.value,
                                        },
                                    })
                                }
                                placeholder="값"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
