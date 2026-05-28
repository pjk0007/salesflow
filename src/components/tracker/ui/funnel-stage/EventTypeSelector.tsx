"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageMatch, FunnelOptions } from "../../types/funnel";
import { CUSTOM } from "./constants";

interface Props {
    eventTypes: FunnelOptions["eventTypes"];
    current: Extract<StageMatch, { type: "record_event" }>;
    onChange: (next: StageMatch) => void;
}

/**
 * 이벤트 선택 — 한글 label 위주로 평탄화해서 보여줌.
 * 운영자는 익숙한 한글로 선택, 시스템은 type+label 둘 다 저장.
 * label이 없는 type은 type 자체를 표시.
 */
export function EventTypeSelector({ eventTypes, current, onChange }: Props) {
    type Option = { value: string; type: string; label?: string; display: string };
    const options: Option[] = [];
    for (const e of eventTypes) {
        if (e.labels.length === 0) {
            options.push({ value: `${e.type}::`, type: e.type, display: e.type });
        } else {
            for (const l of e.labels) {
                options.push({ value: `${e.type}::${l}`, type: e.type, label: l, display: l });
            }
        }
    }

    const currentValue = current.eventType
        ? `${current.eventType}::${current.label ?? ""}`
        : "";
    const matchedOption = options.find((o) => o.value === currentValue);
    const isCustom = current.eventType && !matchedOption;

    return (
        <>
            <Select
                value={isCustom ? CUSTOM : currentValue}
                onValueChange={(v) => {
                    if (v === CUSTOM) {
                        onChange({ type: "record_event", eventType: "" });
                        return;
                    }
                    const opt = options.find((o) => o.value === v);
                    if (opt) {
                        onChange({ type: "record_event", eventType: opt.type, label: opt.label });
                    }
                }}
            >
                <SelectTrigger className="h-8 w-44 min-w-0 text-xs [&>span]:truncate">
                    <SelectValue placeholder="이벤트 선택" />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value} title={o.label ? `${o.type} / ${o.label}` : o.type}>
                            {o.display}
                        </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>직접 입력</SelectItem>
                </SelectContent>
            </Select>
            {isCustom && (
                <>
                    <Input
                        placeholder="이벤트 타입"
                        value={current.eventType}
                        onChange={(e) => onChange({ ...current, eventType: e.target.value })}
                        className="h-8 w-32 text-xs"
                    />
                    <Input
                        placeholder="라벨 (선택)"
                        value={current.label ?? ""}
                        onChange={(e) => onChange({ ...current, label: e.target.value || undefined })}
                        className="h-8 w-32 text-xs"
                    />
                </>
            )}
        </>
    );
}
