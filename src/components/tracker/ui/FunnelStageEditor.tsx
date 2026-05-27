"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowUp, ArrowDown, X } from "lucide-react";
import type { FunnelStage, StageMatch, FunnelOptions } from "../types/funnel";

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

const CUSTOM = "__custom__";   // "직접 입력" 옵션 값
const NONE = "__none__";       // 라벨 없음 옵션 값

export function FunnelStageEditor({ index, stage, options, onChange, onMoveUp, onMoveDown, onRemove }: Props) {
    const updateMatch = (next: StageMatch) => onChange({ ...stage, match: next });

    // 사이트 데이터에서 추출한 옵션
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
                        <EventTypeSelectors
                            eventTypes={eventTypes}
                            current={stage.match}
                            onChange={applyMatchWithLabel}
                        />
                    )}
                    {stage.match.type === "record_field" && (
                        <FieldSelectors
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

/**
 * 이벤트 선택 — 한글 label 위주로 평탄화해서 보여줌.
 * 운영자는 "구독중", "회원가입" 같은 익숙한 한글로 선택, 시스템은 type+label 둘 다 저장.
 * label이 없는 type(이벤트만)은 "(라벨 무관)"으로 별도 옵션.
 */
function EventTypeSelectors({
    eventTypes,
    current,
    onChange,
}: {
    eventTypes: FunnelOptions["eventTypes"];
    current: Extract<StageMatch, { type: "record_event" }>;
    onChange: (next: StageMatch) => void;
}) {
    // 평탄화: label(한글) 위주로 보여주고 type은 보조 정보(툴팁)로.
    // label 없는 type은 type 자체를 표시 (개발자가 박은 영문 키지만 그대로 노출).
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

/** 필드 + 값 드롭다운 (select 필드 옵션에서) */
function FieldSelectors({
    selectFields,
    current,
    onChange,
}: {
    selectFields: FunnelOptions["selectFields"];
    current: Extract<StageMatch, { type: "record_field" }>;
    onChange: (next: StageMatch) => void;
}) {
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

/** 페이지 경로 — 인기 페이지 드롭다운 + 직접 입력 */
function PageSelector({
    popularPaths,
    current,
    onChange,
}: {
    popularPaths: string[];
    current: Extract<StageMatch, { type: "page_url" }>;
    onChange: (next: StageMatch) => void;
}) {
    const isCustom = current.pathPrefix && !popularPaths.includes(current.pathPrefix);
    return (
        <>
            <Select
                value={isCustom ? CUSTOM : (current.pathPrefix || "")}
                onValueChange={(v) => {
                    if (v === CUSTOM) onChange({ type: "page_url", pathPrefix: "" });
                    else onChange({ type: "page_url", pathPrefix: v });
                }}
            >
                <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue placeholder="인기 페이지 선택" />
                </SelectTrigger>
                <SelectContent>
                    {popularPaths.map((p) => (
                        <SelectItem key={p} value={p}>
                            <span className="font-mono">{p}</span>
                        </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM}>직접 입력</SelectItem>
                </SelectContent>
            </Select>
            {isCustom && (
                <Input
                    placeholder="경로 prefix (예: /pricing)"
                    value={current.pathPrefix}
                    onChange={(e) => onChange({ ...current, pathPrefix: e.target.value })}
                    className="h-8 w-44 font-mono text-xs"
                />
            )}
        </>
    );
}

function slugify(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function defaultMatchFor(type: StageMatch["type"]): StageMatch {
    if (type === "record_event") return { type, eventType: "" };
    if (type === "record_field") return { type, field: "", value: "" };
    return { type: "page_url", pathPrefix: "" };
}
