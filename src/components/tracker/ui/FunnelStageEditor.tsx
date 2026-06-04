"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import type { FunnelStage, StageMatch, FunnelOptions } from "../types/funnel";
import { FieldValueSelector } from "./funnel-stage/FieldValueSelector";
import { PageSelector } from "./funnel-stage/PageSelector";
import { CustomEventSelector } from "./funnel-stage/CustomEventSelector";
import { slugify, defaultMatchFor } from "./funnel-stage/utils";

const MATCH_TYPES: Array<{ value: StageMatch["type"]; label: string; hint: string }> = [
    { value: "record_field", label: "필드 값", hint: "예: 매치 단계가 '신청완료'였던 적이 있는 사람 (이력 기반)" },
    { value: "page_url", label: "페이지 방문", hint: "예: /pricing 같은 특정 경로를 한 번이라도 방문한 사람" },
    { value: "custom_event", label: "이벤트 발생", hint: "예: 'subscribe_step_2' 같은 CUSTOM 이벤트를 한 번이라도 발생시킨 사람" },
];

interface Props {
    index: number;
    stage: FunnelStage;
    options: FunnelOptions | null;
    onChange: (next: FunnelStage) => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onRemove: () => void;
}

export function FunnelStageEditor({ index, stage, options, onChange, onMoveUp, onMoveDown, onRemove }: Props) {
    const updateMatch = (next: StageMatch) => onChange({ ...stage, match: next });

    const eventTypes = options?.eventTypes ?? [];
    const popularPaths = options?.popularPaths ?? [];
    const customEvents = options?.customEvents ?? [];

    // 단계 라벨 자동 추천: 사용자 입력 비어있을 때 매칭 값에서 따옴.
    // custom_event는 이벤트 라벨 카드에 정의된 한글 라벨을 우선 사용 (없으면 이벤트 코드).
    const suggestLabel = (m: StageMatch): string => {
        if (m.type === "record_field") return m.value ?? "";
        if (m.type === "page_url") return m.pathPrefix ?? "";
        if (m.type === "custom_event") {
            const def = customEvents.find((e) => e.eventName === m.eventName);
            return def?.label || m.eventName || "";
        }
        return "";
    };
    const applyMatchWithLabel = (next: StageMatch) => {
        const suggested = suggestLabel(next);
        const shouldFillLabel = !stage.label.trim() && suggested;
        onChange({
            ...stage,
            match: next,
            label: shouldFillLabel ? suggested : stage.label,
            key: shouldFillLabel ? slugify(suggested) : stage.key,
        });
    };

    return (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-sm font-medium text-muted-foreground">{index + 3}</span>
                <Input
                    placeholder="단계 이름 (예: 신청완료) — 비우면 자동"
                    value={stage.label}
                    onChange={(e) => onChange({ ...stage, label: e.target.value, key: slugify(e.target.value) || stage.key })}
                    className="h-8 text-sm"
                />
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onMoveUp} disabled={!onMoveUp}>
                    <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onMoveDown} disabled={!onMoveDown}>
                    <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-700" onClick={onRemove}>
                    <X className="h-3.5 w-3.5" />
                </Button>
            </div>

            <div className="ml-8 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={stage.match.type} onValueChange={(v) => updateMatch(defaultMatchFor(v as StageMatch["type"]))}>
                        <SelectTrigger className="h-8 w-36 min-w-0 text-xs [&>span]:truncate">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {MATCH_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value} title={t.hint}>
                                    {t.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {stage.match.type === "record_field" && (
                        <FieldValueSelector
                            eventTypes={eventTypes}
                            current={stage.match}
                            onChange={applyMatchWithLabel}
                        />
                    )}
                    {stage.match.type === "page_url" && (
                        <PageSelector
                            popularPaths={popularPaths}
                            current={stage.match}
                            onChange={applyMatchWithLabel}
                        />
                    )}
                    {stage.match.type === "custom_event" && (
                        <CustomEventSelector
                            customEvents={customEvents}
                            current={stage.match}
                            onChange={applyMatchWithLabel}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
