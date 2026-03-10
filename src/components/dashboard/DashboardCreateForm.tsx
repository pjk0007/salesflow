"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";

interface DashboardCreateFormProps {
    newName: string;
    onNewNameChange: (v: string) => void;
    aiPrompt: string;
    onAiPromptChange: (v: string) => void;
    creating: boolean;
    onSubmit: () => void;
    onCancel: () => void;
}

export default function DashboardCreateForm({
    newName,
    onNewNameChange,
    aiPrompt,
    onAiPromptChange,
    creating,
    onSubmit,
    onCancel,
}: DashboardCreateFormProps) {
    const hasAi = !!aiPrompt.trim();

    return (
        <div className="border rounded-lg p-4 space-y-3">
            <div className="space-y-2">
                <Label>대시보드 이름</Label>
                <Input
                    value={newName}
                    onChange={(e) => onNewNameChange(e.target.value)}
                    placeholder="대시보드 이름"
                />
            </div>
            <div className="space-y-2">
                <Label className="flex items-center gap-1">
                    <Sparkles className="h-4 w-4" /> AI 위젯 자동 생성
                    <span className="text-muted-foreground font-normal">(선택)</span>
                </Label>
                <Textarea
                    value={aiPrompt}
                    onChange={(e) => onAiPromptChange(e.target.value)}
                    placeholder="예: 영업 현황 대시보드, 월별 매출 분석"
                    rows={2}
                />
                <p className="text-xs text-muted-foreground">
                    입력하면 대시보드 이름과 위젯을 AI가 자동으로 구성합니다.
                </p>
            </div>
            <div className="flex gap-2">
                <Button
                    onClick={onSubmit}
                    disabled={creating || (!newName && !hasAi)}
                >
                    {creating ? (hasAi ? "AI 생성 중..." : "생성 중...") : (hasAi ? "AI로 생성" : "생성")}
                </Button>
                <Button variant="outline" onClick={onCancel}>
                    취소
                </Button>
            </div>
        </div>
    );
}
