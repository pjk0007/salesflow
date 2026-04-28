"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { extractAllTemplateVariables } from "@/lib/alimtalk-template-utils";

const MAX_STEPS = 5;

export interface FollowupStepUI {
    delayValue: number;
    delayUnit: "hours" | "days";
    senderKey: string;
    templateCode: string;
    variableMappings: Record<string, string>;
}

interface SenderOption {
    senderKey: string;
    plusFriendId?: string;
}

interface FieldOption {
    key: string;
    label: string;
}

interface FollowupStepsFormProps {
    senderKey: string;
    senders: SenderOption[];
    fields: FieldOption[];
    steps: FollowupStepUI[];
    onChange: (steps: FollowupStepUI[]) => void;
}

export default function FollowupStepsForm({
    senderKey,
    senders,
    fields,
    steps,
    onChange,
}: FollowupStepsFormProps) {
    const updateStep = (index: number, patch: Partial<FollowupStepUI>) => {
        const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
        onChange(next);
    };

    const removeStep = (index: number) => {
        onChange(steps.filter((_, i) => i !== index));
    };

    const addStep = () => {
        if (steps.length >= MAX_STEPS) return;
        onChange([
            ...steps,
            {
                delayValue: 1,
                delayUnit: "days",
                senderKey: "",
                templateCode: "",
                variableMappings: {},
            },
        ]);
    };

    return (
        <div className="space-y-3">
            {steps.map((step, index) => (
                <StepCard
                    key={index}
                    index={index}
                    step={step}
                    fallbackSenderKey={senderKey}
                    senders={senders}
                    fields={fields}
                    onChange={(patch) => updateStep(index, patch)}
                    onRemove={() => removeStep(index)}
                />
            ))}

            <Button
                type="button"
                variant="outline"
                onClick={addStep}
                disabled={steps.length >= MAX_STEPS}
                className="w-full"
            >
                <Plus className="h-4 w-4 mr-2" />
                Step 추가 ({steps.length}/{MAX_STEPS})
            </Button>
        </div>
    );
}

interface StepCardProps {
    index: number;
    step: FollowupStepUI;
    fallbackSenderKey: string;
    senders: SenderOption[];
    fields: FieldOption[];
    onChange: (patch: Partial<FollowupStepUI>) => void;
    onRemove: () => void;
}

function StepCard({
    index,
    step,
    fallbackSenderKey,
    senders,
    fields,
    onChange,
    onRemove,
}: StepCardProps) {
    const effectiveSenderKey = step.senderKey || fallbackSenderKey || null;
    const { templates } = useAlimtalkTemplates(effectiveSenderKey);
    const selectedTemplate = templates.find((t) => t.templateCode === step.templateCode);
    const variables = useMemo(
        () => extractAllTemplateVariables(selectedTemplate ?? null),
        [selectedTemplate]
    );

    return (
        <div className="rounded-md border p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Step {index + 1}</span>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onRemove}
                    className="h-7 w-7"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </div>

            <div className="space-y-1.5">
                <Label className="text-xs">대기 기간</Label>
                <div className="flex items-center gap-2">
                    <Input
                        type="number"
                        min={1}
                        max={step.delayUnit === "hours" ? 720 : 30}
                        value={step.delayValue}
                        onChange={(e) => onChange({ delayValue: Number(e.target.value) })}
                        className="w-24"
                    />
                    <ToggleGroup
                        type="single"
                        value={step.delayUnit}
                        onValueChange={(v) => v && onChange({ delayUnit: v as "hours" | "days" })}
                        variant="outline"
                        size="sm"
                    >
                        <ToggleGroupItem value="hours" className="px-4">시간</ToggleGroupItem>
                        <ToggleGroupItem value="days" className="px-4">일</ToggleGroupItem>
                    </ToggleGroup>
                </div>
                <p className="text-xs text-muted-foreground">
                    {index === 0 ? "자동발송 후" : `Step ${index} 발송 후`} {step.delayValue}
                    {step.delayUnit === "hours" ? "시간" : "일"} 뒤 발송
                </p>
            </div>

            <div className="space-y-1.5">
                <Label className="text-xs">발신 프로필</Label>
                <Select
                    value={step.senderKey || fallbackSenderKey}
                    onValueChange={(v) => onChange({ senderKey: v, templateCode: "", variableMappings: {} })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="발신 프로필 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {senders.map((s) => (
                            <SelectItem key={s.senderKey} value={s.senderKey}>
                                {s.plusFriendId || s.senderKey}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5">
                <Label className="text-xs">알림톡 템플릿</Label>
                <Select
                    value={step.templateCode}
                    onValueChange={(v) => onChange({ templateCode: v, variableMappings: {} })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="템플릿 선택" />
                    </SelectTrigger>
                    <SelectContent>
                        {templates.map((t) => (
                            <SelectItem key={t.templateCode} value={t.templateCode}>
                                {t.templateName || t.templateCode}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {variables.length > 0 && (
                <div className="space-y-1.5">
                    <Label className="text-xs">변수 매핑</Label>
                    {variables.map((v) => (
                        <div key={v} className="flex items-center gap-2">
                            <span className="text-sm font-mono w-[140px] shrink-0">{v}</span>
                            <span className="text-muted-foreground">&rarr;</span>
                            <Select
                                value={step.variableMappings[v] || ""}
                                onValueChange={(val) =>
                                    onChange({
                                        variableMappings: { ...step.variableMappings, [v]: val },
                                    })
                                }
                            >
                                <SelectTrigger className="flex-1">
                                    <SelectValue placeholder="필드 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {fields.map((f) => (
                                        <SelectItem key={f.key} value={f.key}>
                                            {f.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
