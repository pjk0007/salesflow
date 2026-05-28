"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import type { FunnelStage, StageMatch, FunnelOptions } from "../types/funnel";
import { EventTypeSelector } from "./funnel-stage/EventTypeSelector";
import { FieldSelector } from "./funnel-stage/FieldSelector";
import { PageSelector } from "./funnel-stage/PageSelector";
import { slugify, defaultMatchFor } from "./funnel-stage/utils";

const MATCH_TYPES: Array<{ value: StageMatch["type"]; label: string; hint: string }> = [
    { value: "record_event", label: "행동 이벤트", hint: "회원가입·단계변경 같이 '언제' 이 단계에 도달했는지 시점 추적 (권장)" },
    { value: "record_field", label: "현재 상태", hint: "고객의 현재 단계/상태 값으로 매칭 (시점 정보 없음)" },
    { value: "page_url", label: "페이지 방문", hint: "특정 경로(/pricing 등) 본 적 있는 사용자" },
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
    const selectFields = options?.selectFields ?? [];
    const popularPaths = options?.popularPaths ?? [];

    // 단계 라벨 자동 추천: 사용자 입력 비어있을 때 매칭 값에서 따옴
    const suggestLabel = (m: StageMatch): string => {
        if (m.type === "record_event") return m.label ?? m.eventType ?? "";
        if (m.type === "record_field") return m.value ?? "";
        if (m.type === "page_url") return m.pathPrefix ?? "";
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
                    placeholder="단계 이름 (예: 회원가입) — 비우면 자동"
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

                    {stage.match.type === "record_event" && (
                        <EventTypeSelector
                            eventTypes={eventTypes}
                            current={stage.match}
                            onChange={applyMatchWithLabel}
                        />
                    )}
                    {stage.match.type === "record_field" && (
                        <FieldSelector
                            selectFields={selectFields}
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
                </div>
            </div>
        </div>
    );
}
