"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageMatch, FunnelOptions } from "../../types/funnel";
import { CUSTOM } from "./constants";

interface Props {
    selectFields: FunnelOptions["selectFields"];
    current: Extract<StageMatch, { type: "record_field" }>;
    onChange: (next: StageMatch) => void;
}

/** 필드 + 값 드롭다운 (select 필드 옵션에서) */
export function FieldSelector({ selectFields, current, onChange }: Props) {
    const valuesOfCurrent = selectFields.find((f) => f.key === current.field)?.options ?? [];
    const isFieldCustom = current.field && !selectFields.some((f) => f.key === current.field);

    return (
        <>
            <Select
                value={isFieldCustom ? CUSTOM : (current.field || "")}
                onValueChange={(v) => {
                    if (v === CUSTOM) onChange({ type: "record_field", field: "", value: "" });
                    else onChange({ type: "record_field", field: v, value: "" });
                }}
            >
                <SelectTrigger className="h-8 w-36 min-w-0 text-xs [&>span]:truncate">
                    <SelectValue placeholder="필드 선택" />
                </SelectTrigger>
                <SelectContent>
                    {selectFields.map((f) => (
                        <SelectItem key={f.key} value={f.key} title={f.key}>
                            {f.label}
                        </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>직접 입력</SelectItem>
                </SelectContent>
            </Select>
            {isFieldCustom && (
                <Input
                    placeholder="필드명 직접 입력"
                    value={current.field}
                    onChange={(e) => onChange({ ...current, field: e.target.value })}
                    className="h-8 w-32 text-xs"
                />
            )}
            {valuesOfCurrent.length > 0 ? (
                <Select
                    value={current.value || ""}
                    onValueChange={(v) => onChange({ ...current, value: v })}
                >
                    <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue placeholder="값 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {valuesOfCurrent.map((v) => (
                            <SelectItem key={v} value={v}>{v}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : current.field ? (
                <Input
                    placeholder="값 직접 입력"
                    value={current.value}
                    onChange={(e) => onChange({ ...current, value: e.target.value })}
                    className="h-8 w-32 text-xs"
                />
            ) : null}
        </>
    );
}
