"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { StageMatch } from "../../types/funnel";
import { CUSTOM } from "./constants";

interface Props {
    customEvents: Array<{ eventName: string; label: string }>;
    current: Extract<StageMatch, { type: "custom_event" }>;
    onChange: (next: StageMatch) => void;
}

/** CUSTOM 이벤트 — 정의된 이벤트(이름+라벨) 드롭다운 + 직접 입력 */
export function CustomEventSelector({ customEvents, current, onChange }: Props) {
    const isCustom = current.eventName && !customEvents.some((e) => e.eventName === current.eventName);

    return (
        <>
            <Select
                value={isCustom ? CUSTOM : (current.eventName || "")}
                onValueChange={(v) => {
                    if (v === CUSTOM) onChange({ type: "custom_event", eventName: "" });
                    else onChange({ type: "custom_event", eventName: v });
                }}
            >
                <SelectTrigger className="h-8 w-52 text-xs">
                    <SelectValue placeholder="이벤트 선택" />
                </SelectTrigger>
                <SelectContent>
                    {customEvents.map((e) => (
                        <SelectItem key={e.eventName} value={e.eventName}>
                            {e.label
                                ? <span>{e.label} <span className="ml-1 font-mono text-[10px] text-muted-foreground">{e.eventName}</span></span>
                                : <span className="font-mono">{e.eventName}</span>}
                        </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>직접 입력</SelectItem>
                </SelectContent>
            </Select>
            {isCustom && (
                <Input
                    placeholder="이벤트 이름 (예: subscribe_step_2)"
                    value={current.eventName}
                    onChange={(e) => onChange({ ...current, eventName: e.target.value })}
                    className="h-8 w-44 font-mono text-xs"
                />
            )}
        </>
    );
}
