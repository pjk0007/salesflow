"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
    capForDate,
    DEFAULT_WARMUP_START,
    DEFAULT_WARMUP_STEP,
    hasAnyLimit,
    nextSendableAt,
    type SenderLimitSettings,
} from "@/lib/email-sender-limit-rules";
import { isWeekdayYmd, kstParts } from "@/lib/kst";
import type { LimitField, SenderLimitForm } from "../types";
import {
    applyWarmupToggle,
    formatYmdShort,
    previewCells,
    spreadGapLabel,
    todayKstYmd,
    warmupAutoFillNote,
    warmupDayNumber,
    weekdayLabel,
    type LimitFormCheck,
} from "../utils/limitForm";
import SenderLimitBadges from "./SenderLimitBadges";

const START_HOURS = Array.from({ length: 24 }, (_, i) => i); // 0~23
const END_HOURS = Array.from({ length: 24 }, (_, i) => i + 1); // 1~24

interface SenderLimitSectionProps {
    value: SenderLimitForm;
    onChange: (next: SenderLimitForm) => void;
    /** 지금 저장된 값. 새 프로필이면 DEFAULT_LIMIT_SETTINGS. 검증과 미리보기는 여기에 입력을 합친 결과로 한다 */
    stored: SenderLimitSettings;
    /** inspectLimitForm(value, stored, 오늘) — 대화상자가 저장 버튼과 함께 쓰려고 한 번 계산해 넘긴다 */
    check: LimitFormCheck;
    /** 오늘 이 주소로 이미 보낸 수. 새 프로필이면 0, 사용량을 못 읽었으면 null */
    sentToday: number | null;
    /** 관리자가 아니면 보기만 한다 (서버가 한도 칸 변경에 관리자 권한을 요구한다) */
    readOnly?: boolean;
}

function ToggleRow({
    id,
    field,
    label,
    description,
    checked,
    onCheckedChange,
    disabled,
    children,
}: {
    id: string;
    field?: string;
    label: string;
    description: ReactNode;
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    disabled?: boolean;
    children?: ReactNode;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <Label htmlFor={id}>{label}</Label>
                    <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                    id={id}
                    data-limit-field={field}
                    checked={checked}
                    onCheckedChange={onCheckedChange}
                    disabled={disabled}
                />
            </div>
            {children}
        </div>
    );
}

function CountInput({
    id,
    field,
    value,
    onChange,
    placeholder,
    min,
    disabled,
    invalid,
    errorId,
}: {
    id: string;
    field: LimitField;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    min: number;
    disabled?: boolean;
    invalid: boolean;
    errorId: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <Input
                id={id}
                data-limit-field={field}
                type="number"
                inputMode="numeric"
                min={min}
                step={1}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                className="w-28"
            />
            <span className="text-sm text-muted-foreground">통</span>
        </div>
    );
}

/** 오류를 그 칸 바로 아래에 둔다 — 저장을 누르기 전에, 스크롤 없이 보이게 */
function FieldError({ check, field, id }: { check: LimitFormCheck; field: LimitField; id: string }) {
    if (check.ok || check.field !== field) return null;
    return (
        <p id={id} role="alert" className="text-xs text-destructive">
            {check.error}
        </p>
    );
}

/**
 * 발신자 프로필 대화상자의 "발송 한도·웜업" 구역.
 * 넓은 화면에서는 왼쪽에 입력, 오른쪽에 "오늘"과 앞으로 14일 미리보기를 나란히 두어 입력하면서 결과를 본다.
 * 좁은 화면에서는 입력 아래로 미리보기가 내려온다.
 */
export default function SenderLimitSection({
    value,
    onChange,
    stored,
    check,
    sentToday,
    readOnly = false,
}: SenderLimitSectionProps) {
    const uid = useId();
    const today = todayKstYmd();
    const errId = (field: LimitField) => `${uid}-err-${field}`;
    const invalid = (field: LimitField) => !check.ok && check.field === field;

    const set = <K extends keyof SenderLimitForm>(key: K, v: SenderLimitForm[K]) => onChange({ ...value, [key]: v });

    // 시간대를 끄면 고르게 나누기는 성립하지 않는다 (나눌 시간 길이가 없다)
    const toggleWindow = (on: boolean) =>
        onChange({ ...value, windowEnabled: on, ...(!on && { spreadEvenly: false }) });

    const hasCap = value.dailyLimit.trim() !== "" || value.warmupEnabled;
    const canSpread = value.windowEnabled && hasCap;
    const spreadBlockedReason = !value.windowEnabled
        ? "발송 시간대를 켜면 쓸 수 있습니다."
        : !hasCap
            ? "하루 최대 발송 수를 정하면 쓸 수 있습니다."
            : null;

    const merged = check.ok ? check.value : null;
    const gapLabel = merged && merged.spreadEvenly ? spreadGapLabel(merged, today) : null;
    const autoFill = warmupAutoFillNote(value);

    // 웜업 날수: 쉬는 날(평일만인데 주말)에는 "오늘 n일째"가 오늘도 세는지 헷갈리므로 다음 발송일로 적는다
    const warmupLine = (() => {
        if (!merged?.warmupEnabled) return null;
        if (!(stored.warmupEnabled && merged.warmupStartedOn)) {
            // 평일만인데 오늘이 주말이면 배지처럼 다음 발송일을 1일째로 적는다 (주말은 날수에 넣지 않는다)
            if (merged.weekdaysOnly && !isWeekdayYmd(today)) {
                const nextDay = kstParts(nextSendableAt(merged, new Date())).date;
                return `저장하면 다음 발송일 ${formatYmdShort(nextDay)}(${weekdayLabel(nextDay)})을 1일째로 셉니다.`;
            }
            return "저장하면 오늘을 1일째로 셉니다.";
        }
        const started = `${formatYmdShort(merged.warmupStartedOn)}에 시작`;
        if (merged.weekdaysOnly && !isWeekdayYmd(today)) {
            const nextDay = kstParts(nextSendableAt(merged, new Date())).date;
            return `${started} · 다음 발송일 ${formatYmdShort(nextDay)}(${weekdayLabel(nextDay)})이 ${warmupDayNumber(merged, nextDay)}일째`;
        }
        return `${started} · 오늘 ${warmupDayNumber(merged, today)}일째`;
    })();

    return (
        <section className="space-y-3 border-t pt-4">
            <div>
                <p className="text-sm font-medium">발송 한도·웜업</p>
                <p className="text-xs text-muted-foreground">
                    아무것도 켜지 않으면 지금처럼 제한 없이 보냅니다. 한도에 걸린 자동 발송 메일은 버리지 않고 보낼 수 있을 때로 미룹니다.
                </p>
                {readOnly && (
                    <p className="text-xs text-amber-600 mt-1">발송 한도는 관리자만 바꿀 수 있습니다.</p>
                )}
            </div>

            <div className="grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
                {/* 입력 */}
                <div className="space-y-3.5">
                    <FieldError check={check} field="general" id={errId("general")} />

                    <ToggleRow
                        id={`${uid}-paused`}
                        label="일시 정지"
                        description="이 주소로는 보내지 않습니다. 자동 발송 메일은 미뤄 두었다가, 정지를 풀면 다음 보낼 수 있는 날부터 나갑니다."
                        checked={value.isPaused}
                        onCheckedChange={(v) => set("isPaused", v)}
                        disabled={readOnly}
                    />

                    <div className="space-y-1.5">
                        <Label htmlFor={`${uid}-daily`}>하루 최대 발송 수</Label>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <CountInput
                                id={`${uid}-daily`}
                                field="dailyLimit"
                                value={value.dailyLimit}
                                onChange={(v) => set("dailyLimit", v)}
                                placeholder="제한 없음"
                                min={1}
                                disabled={readOnly}
                                invalid={invalid("dailyLimit")}
                                errorId={errId("dailyLimit")}
                            />
                            <span className="text-xs text-muted-foreground">비워 두면 제한하지 않습니다. 웜업은 여기서 멈춥니다.</span>
                        </div>
                        <FieldError check={check} field="dailyLimit" id={errId("dailyLimit")} />
                    </div>

                    <ToggleRow
                        id={`${uid}-warmup`}
                        label="웜업"
                        description="첫날 적게 보내고 날마다 조금씩 늘려 하루 최대에서 멈춥니다."
                        checked={value.warmupEnabled}
                        onCheckedChange={(on) => onChange(applyWarmupToggle(value, on))}
                        disabled={readOnly}
                    >
                        {value.warmupEnabled && (
                            <div className="space-y-1.5 pl-1">
                                <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                                    <div className="space-y-1">
                                        <Label htmlFor={`${uid}-wstart`} className="text-xs">첫날</Label>
                                        <CountInput
                                            id={`${uid}-wstart`}
                                            field="warmupStartCount"
                                            value={value.warmupStartCount}
                                            onChange={(v) => set("warmupStartCount", v)}
                                            placeholder={String(DEFAULT_WARMUP_START)}
                                            min={1}
                                            disabled={readOnly}
                                            invalid={invalid("warmupStartCount")}
                                            errorId={errId("warmupStartCount")}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label htmlFor={`${uid}-wstep`} className="text-xs">하루 증가</Label>
                                        <CountInput
                                            id={`${uid}-wstep`}
                                            field="warmupStep"
                                            value={value.warmupStep}
                                            onChange={(v) => set("warmupStep", v)}
                                            placeholder={String(DEFAULT_WARMUP_STEP)}
                                            min={0}
                                            disabled={readOnly}
                                            invalid={invalid("warmupStep")}
                                            errorId={errId("warmupStep")}
                                        />
                                    </div>
                                </div>
                                <FieldError check={check} field="warmupStartCount" id={errId("warmupStartCount")} />
                                <FieldError check={check} field="warmupStep" id={errId("warmupStep")} />
                                {warmupLine && (
                                    <p className="text-xs text-muted-foreground">
                                        {warmupLine}
                                        {merged?.weekdaysOnly && " 평일만 보내면 주말은 날수에 넣지 않습니다."}
                                    </p>
                                )}
                                {autoFill && (
                                    <p className="text-xs text-primary">
                                        웜업 권장값으로 채웠습니다: {autoFill}. 그대로 저장하거나 바꿔도 됩니다.
                                    </p>
                                )}
                            </div>
                        )}
                    </ToggleRow>

                    <ToggleRow
                        id={`${uid}-window`}
                        label="발송 시간대"
                        description="한국 시각 기준, 정시 단위로 정합니다."
                        checked={value.windowEnabled}
                        onCheckedChange={toggleWindow}
                        disabled={readOnly}
                    >
                        {value.windowEnabled && (
                            <div className="space-y-1.5 pl-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <Select
                                        value={String(value.sendWindowStart)}
                                        onValueChange={(v) => set("sendWindowStart", Number(v))}
                                        disabled={readOnly}
                                    >
                                        <SelectTrigger
                                            className="w-24"
                                            aria-label="발송 시작 시각"
                                            data-limit-field="window"
                                            aria-invalid={invalid("window") || undefined}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {START_HOURS.map((h) => (
                                                <SelectItem key={h} value={String(h)}>{h}시</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <span className="text-muted-foreground">부터</span>
                                    <Select
                                        value={String(value.sendWindowEnd)}
                                        onValueChange={(v) => set("sendWindowEnd", Number(v))}
                                        disabled={readOnly}
                                    >
                                        <SelectTrigger
                                            className="w-24"
                                            aria-label="발송 종료 시각"
                                            aria-invalid={invalid("window") || undefined}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {END_HOURS.map((h) => (
                                                <SelectItem key={h} value={String(h)}>{h}시</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <span className="text-muted-foreground">전까지</span>
                                </div>
                                <FieldError check={check} field="window" id={errId("window")} />
                            </div>
                        )}
                    </ToggleRow>

                    <ToggleRow
                        id={`${uid}-weekdays`}
                        label="평일만"
                        description="토·일요일에는 보내지 않습니다."
                        checked={value.weekdaysOnly}
                        onCheckedChange={(v) => set("weekdaysOnly", v)}
                        disabled={readOnly}
                    />

                    <ToggleRow
                        id={`${uid}-spread`}
                        field="spreadEvenly"
                        label="고르게 나눠 보내기"
                        description={
                            !value.spreadEvenly && spreadBlockedReason && !readOnly
                                ? `하루 한도를 시간대 안에서 같은 간격으로 나눠 보냅니다. ${spreadBlockedReason}`
                                : "하루 한도를 시간대 안에서 같은 간격으로 나눠 보냅니다. 시간대와 하루 한도가 있어야 합니다."
                        }
                        checked={value.spreadEvenly}
                        onCheckedChange={(v) => set("spreadEvenly", v)}
                        // 켜 둔 것을 끄는 것은 늘 되게 하고, 새로 켜는 것만 조건을 본다
                        disabled={readOnly || (!value.spreadEvenly && !canSpread)}
                    >
                        <FieldError check={check} field="spreadEvenly" id={errId("spreadEvenly")} />
                        {gapLabel && (
                            <p className="pl-1 text-xs text-muted-foreground">오늘 기준 {gapLabel} 간격으로 보냅니다.</p>
                        )}
                    </ToggleRow>
                </div>

                {/* 결과: 입력하는 동안 같이 보인다 */}
                <aside className="space-y-3 md:border-l md:pl-6">
                    <LimitPreview merged={merged} invalid={!check.ok} today={today} sentToday={sentToday} />
                </aside>
            </div>
        </section>
    );
}

function LimitPreview({
    merged,
    invalid,
    today,
    sentToday,
}: {
    merged: SenderLimitSettings | null;
    invalid: boolean;
    today: string;
    sentToday: number | null;
}) {
    if (invalid || !merged) {
        return (
            <div className="space-y-2">
                <p className="text-xs font-medium">앞으로 14일 하루 한도</p>
                <div className="rounded border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                    빨간 글씨로 표시한 칸을 고치면 미리보기가 다시 보입니다.
                </div>
            </div>
        );
    }
    if (!hasAnyLimit(merged)) {
        return (
            <p className="rounded border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                한도를 하나도 켜지 않아 지금처럼 제한 없이 바로 보냅니다. 왼쪽에서 켜면 여기에 오늘과 앞으로 14일 한도가 보입니다.
            </p>
        );
    }

    const usage = sentToday === null ? undefined : { usageDate: today, sentToday, cap: capForDate(merged, today) };
    return (
        <>
            <div className="space-y-1.5">
                <p className="text-xs font-medium">이 설정이면 오늘</p>
                <div className="flex flex-wrap items-center gap-1">
                    <SenderLimitBadges settings={merged} usage={usage} />
                </div>
            </div>
            <div className="space-y-2">
                <p className="text-xs font-medium">앞으로 14일 하루 한도</p>
                <div className="grid grid-cols-7 gap-1">
                    {previewCells(merged, today).map((c) => (
                        <div
                            key={c.date}
                            className={cn(
                                "rounded border px-0.5 py-1.5 text-center",
                                c.date === today && "border-primary",
                                c.kind === "off" && "bg-muted text-muted-foreground",
                                c.kind === "paused" && "bg-destructive/10 text-destructive",
                            )}
                        >
                            <div className="text-[10px] text-muted-foreground">
                                {c.date === today ? "오늘" : `${formatYmdShort(c.date)} ${weekdayLabel(c.date)}`}
                            </div>
                            <div className="text-xs font-medium tabular-nums">{c.text}</div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
