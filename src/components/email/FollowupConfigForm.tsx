"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface TemplateFollowupStep {
    delayDays: number;
    onOpened?: { templateId: number };
    onNotOpened?: { templateId: number };
}

interface AiFollowupStep {
    delayDays: number;
    onOpened?: { prompt: string };
    onNotOpened?: { prompt: string };
}

type FollowupStep = TemplateFollowupStep | AiFollowupStep;

interface EmailTemplate {
    id: number;
    name: string;
}

interface FollowupConfigFormProps {
    mode: "template" | "ai";
    value: FollowupStep[] | FollowupStep | null;
    onChange: (config: FollowupStep[] | null) => void;
    templates?: EmailTemplate[];
}

const MAX_STEPS = 5;

/** Normalize to array for backward compat */
function normalizeSteps(val: FollowupStep[] | FollowupStep | null): FollowupStep[] {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val];
}

export function FollowupConfigForm({ mode, value, onChange, templates }: FollowupConfigFormProps) {
    const steps = normalizeSteps(value);
    const enabled = steps.length > 0;

    const handleToggle = () => {
        if (enabled) {
            onChange(null);
        } else {
            onChange([{ delayDays: 3 }]);
        }
    };

    const addStep = () => {
        if (steps.length >= MAX_STEPS) return;
        const lastDelay = steps[steps.length - 1]?.delayDays ?? 3;
        onChange([...steps, { delayDays: Math.min(30, lastDelay + 3) }]);
    };

    const removeStep = (index: number) => {
        const next = steps.filter((_, i) => i !== index);
        onChange(next.length > 0 ? next : null);
    };

    const updateStep = (index: number, updated: FollowupStep) => {
        const next = [...steps];
        next[index] = updated;
        onChange(next);
    };

    const handleDelayChange = (index: number, days: number) => {
        const clamped = Math.max(1, Math.min(30, days));
        updateStep(index, { ...steps[index], delayDays: clamped });
    };

    // Template mode handlers
    const handleTemplateSelect = (index: number, condition: "onOpened" | "onNotOpened", templateId: string) => {
        const step = steps[index] as TemplateFollowupStep;
        if (templateId === "none") {
            const { [condition]: _, ...rest } = step;
            updateStep(index, rest as TemplateFollowupStep);
        } else {
            updateStep(index, { ...step, [condition]: { templateId: Number(templateId) } });
        }
    };

    // AI mode handlers
    const handlePromptChange = (index: number, condition: "onOpened" | "onNotOpened", prompt: string) => {
        const step = steps[index] as AiFollowupStep;
        if (!prompt.trim()) {
            const { [condition]: _, ...rest } = step;
            updateStep(index, rest as AiFollowupStep);
        } else {
            updateStep(index, { ...step, [condition]: { prompt } });
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                    후속 발송 {enabled && <span className="text-muted-foreground font-normal">({steps.length}단계)</span>}
                </Label>
                <Button variant={enabled ? "default" : "outline"} size="sm" onClick={handleToggle}>
                    {enabled ? "OFF" : "ON"}
                </Button>
            </div>

            {enabled && (
                <div className="space-y-4">
                    {steps.map((step, index) => (
                        <div key={index} className="space-y-3 rounded-md border p-3 relative">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-muted-foreground">
                                    {index + 1}단계
                                </span>
                                {steps.length > 1 && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                        onClick={() => removeStep(index)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
                                <Label className="text-sm whitespace-nowrap">대기 일수</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={step.delayDays}
                                    onChange={(e) => handleDelayChange(index, Number(e.target.value))}
                                    className="w-20"
                                />
                                <span className="text-sm text-muted-foreground">일 후 체크</span>
                            </div>

                            {/* 읽었을 때 */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">읽었을 때</Label>
                                {mode === "template" ? (
                                    <Select
                                        value={(step as TemplateFollowupStep).onOpened?.templateId ? String((step as TemplateFollowupStep).onOpened!.templateId) : "none"}
                                        onValueChange={(v) => handleTemplateSelect(index, "onOpened", v)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="템플릿 선택 (선택사항)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">발송 안함</SelectItem>
                                            {templates?.map((t) => (
                                                <SelectItem key={t.id} value={String(t.id)}>
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Textarea
                                        placeholder="AI 지시사항 (선택사항)"
                                        value={(step as AiFollowupStep).onOpened?.prompt ?? ""}
                                        onChange={(e) => handlePromptChange(index, "onOpened", e.target.value)}
                                        rows={2}
                                    />
                                )}
                            </div>

                            {/* 읽지 않았을 때 */}
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">읽지 않았을 때</Label>
                                {mode === "template" ? (
                                    <Select
                                        value={(step as TemplateFollowupStep).onNotOpened?.templateId ? String((step as TemplateFollowupStep).onNotOpened!.templateId) : "none"}
                                        onValueChange={(v) => handleTemplateSelect(index, "onNotOpened", v)}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="템플릿 선택 (선택사항)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">발송 안함</SelectItem>
                                            {templates?.map((t) => (
                                                <SelectItem key={t.id} value={String(t.id)}>
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Textarea
                                        placeholder="AI 지시사항 (선택사항)"
                                        value={(step as AiFollowupStep).onNotOpened?.prompt ?? ""}
                                        onChange={(e) => handlePromptChange(index, "onNotOpened", e.target.value)}
                                        rows={2}
                                    />
                                )}
                            </div>
                        </div>
                    ))}

                    {steps.length < MAX_STEPS && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={addStep}
                        >
                            <Plus className="h-4 w-4 mr-1" />
                            단계 추가 ({steps.length}/{MAX_STEPS})
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
