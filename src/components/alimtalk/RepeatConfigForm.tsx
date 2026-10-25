import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FieldDefinition } from "@/types";

export interface RepeatConfig {
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

/** 바깥 "반복 발송" 스위치를 켤 때 바로 쓰는 기본값(UX-252: 안쪽 체크박스를 따로 켜지 않아도 저장된다) */
export const DEFAULT_REPEAT_CONFIG: RepeatConfig = {
    intervalHours: 24,
    maxRepeat: 3,
    stopCondition: { field: "", operator: "eq", value: "" },
};

export default function RepeatConfigForm({
    fields,
    value: current,
    onChange,
}: RepeatConfigFormProps) {
    // 사용 여부는 화면의 "반복 발송" 스위치 하나로만 정한다. 값이 비어 있으면 기본값으로 보여 준다.
    const value = current ?? DEFAULT_REPEAT_CONFIG;

    return (
        <div className="space-y-3 rounded-lg border p-3">
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
                                <SelectContent position="popper" className="max-h-60">
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
                                <SelectContent position="popper">
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
                                <SelectContent position="popper" className="max-h-60">
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
                                <SelectContent position="popper">
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
                        <p className="text-xs text-muted-foreground">
                            {value.stopCondition.field
                                ? "조건이 충족되면 남은 횟수와 관계없이 반복을 멈춥니다."
                                : "필드를 고르지 않으면 중단 조건 없이 최대 횟수까지 반복합니다."}
                        </p>
                    </div>
                </div>
        </div>
    );
}
