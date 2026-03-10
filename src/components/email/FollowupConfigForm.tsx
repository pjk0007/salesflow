"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface TemplateFollowupConfig {
    delayDays: number;
    onOpened?: { templateId: number };
    onNotOpened?: { templateId: number };
}

interface AiFollowupConfig {
    delayDays: number;
    onOpened?: { prompt: string };
    onNotOpened?: { prompt: string };
}

interface EmailTemplate {
    id: number;
    name: string;
}

interface FollowupConfigFormProps {
    mode: "template" | "ai";
    value: TemplateFollowupConfig | AiFollowupConfig | null;
    onChange: (config: TemplateFollowupConfig | AiFollowupConfig | null) => void;
    templates?: EmailTemplate[];
}

export function FollowupConfigForm({ mode, value, onChange, templates }: FollowupConfigFormProps) {
    const enabled = value !== null;
    const delayDays = value?.delayDays ?? 3;

    const handleToggle = (checked: boolean) => {
        if (checked) {
            onChange({ delayDays: 3 });
        } else {
            onChange(null);
        }
    };

    const handleDelayChange = (days: number) => {
        if (!value) return;
        const clamped = Math.max(1, Math.min(30, days));
        onChange({ ...value, delayDays: clamped });
    };

    // Template mode handlers
    const handleTemplateSelect = (condition: "onOpened" | "onNotOpened", templateId: string) => {
        if (!value) return;
        const config = value as TemplateFollowupConfig;
        if (templateId === "none") {
            const { [condition]: _, ...rest } = config;
            onChange(rest as TemplateFollowupConfig);
        } else {
            onChange({ ...config, [condition]: { templateId: Number(templateId) } });
        }
    };

    // AI mode handlers
    const handlePromptChange = (condition: "onOpened" | "onNotOpened", prompt: string) => {
        if (!value) return;
        const config = value as AiFollowupConfig;
        if (!prompt.trim()) {
            const { [condition]: _, ...rest } = config;
            onChange(rest as AiFollowupConfig);
        } else {
            onChange({ ...config, [condition]: { prompt } });
        }
    };

    const templateConfig = value as TemplateFollowupConfig | null;
    const aiConfig = value as AiFollowupConfig | null;

    return (
        <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">후속 발송</Label>
                <Switch checked={enabled} onCheckedChange={handleToggle} />
            </div>

            {enabled && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Label className="text-sm whitespace-nowrap">대기 일수</Label>
                        <Input
                            type="number"
                            min={1}
                            max={30}
                            value={delayDays}
                            onChange={(e) => handleDelayChange(Number(e.target.value))}
                            className="w-20"
                        />
                        <span className="text-sm text-muted-foreground">일 후 체크</span>
                    </div>

                    {/* 읽었을 때 */}
                    <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">읽었을 때</Label>
                        {mode === "template" ? (
                            <Select
                                value={templateConfig?.onOpened?.templateId ? String(templateConfig.onOpened.templateId) : "none"}
                                onValueChange={(v) => handleTemplateSelect("onOpened", v)}
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
                                value={aiConfig?.onOpened?.prompt ?? ""}
                                onChange={(e) => handlePromptChange("onOpened", e.target.value)}
                                rows={2}
                            />
                        )}
                    </div>

                    {/* 읽지 않았을 때 */}
                    <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">읽지 않았을 때</Label>
                        {mode === "template" ? (
                            <Select
                                value={templateConfig?.onNotOpened?.templateId ? String(templateConfig.onNotOpened.templateId) : "none"}
                                onValueChange={(v) => handleTemplateSelect("onNotOpened", v)}
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
                                value={aiConfig?.onNotOpened?.prompt ?? ""}
                                onChange={(e) => handlePromptChange("onNotOpened", e.target.value)}
                                rows={2}
                            />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
