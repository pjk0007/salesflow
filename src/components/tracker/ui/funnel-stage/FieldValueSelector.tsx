"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageMatch, FunnelOptions } from "../../types/funnel";
import { CUSTOM } from "./constants";

interface Props {
    // 사이트의 추적 ON 필드 + 발생한 record_events 평탄화 옵션
    eventTypes: FunnelOptions["eventTypes"];
    current: Extract<StageMatch, { type: "record_field" }>;
    onChange: (next: StageMatch) => void;
}

/**
 * 필드 값 셀렉터.
 * 사용자는 익숙한 한글 값 한 번만 선택 (예: "신청완료").
 * 시스템은 record_events 이력에 (type=field, label=value) 이벤트가 있는지로 매칭.
 *
 * eventTypes 평탄화 데이터를 그대로 사용. 같은 label이 여러 type에 있으면 type 정보를 툴팁으로 보여줌.
 */
export function FieldValueSelector({ eventTypes, current, onChange }: Props) {
    type Option = { value: string; field: string; label: string; display: string };
    const options: Option[] = [];
    for (const e of eventTypes) {
        for (const l of e.labels) {
            options.push({ value: `${e.type}::${l}`, field: e.type, label: l, display: l });
        }
    }

    const currentValue = current.field && current.value
        ? `${current.field}::${current.value}`
        : "";
    const matchedOption = options.find((o) => o.value === currentValue);
    const isCustom = current.field && !matchedOption;

    return (
        <>
            <Select
                value={isCustom ? CUSTOM : currentValue}
                onValueChange={(v) => {
                    if (v === CUSTOM) {
                        onChange({ type: "record_field", field: "", value: "" });
                        return;
                    }
                    const opt = options.find((o) => o.value === v);
                    if (opt) onChange({ type: "record_field", field: opt.field, value: opt.label });
                }}
            >
                <SelectTrigger className="h-8 w-44 min-w-0 text-xs [&>span]:truncate">
                    <SelectValue placeholder="값 선택" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value} title={`${o.field} / ${o.label}`}>
                            {o.display}
                        </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>직접 입력</SelectItem>
                </SelectContent>
            </Select>
            {isCustom && (
                <>
                    <Input
                        placeholder="필드명"
                        value={current.field}
                        onChange={(e) => onChange({ ...current, field: e.target.value })}
                        className="h-8 w-32 text-xs"
                    />
                    <Input
                        placeholder="값"
                        value={current.value}
                        onChange={(e) => onChange({ ...current, value: e.target.value })}
                        className="h-8 w-32 text-xs"
                    />
                </>
            )}
        </>
    );
}
