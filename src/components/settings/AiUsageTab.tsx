"use client";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAiUsage } from "@/hooks/useAiUsage";
import { Loader2 } from "lucide-react";

const PURPOSE_LABELS: Record<string, string> = {
    email_generation: "이메일 생성",
    auto_personalized_email: "자동 이메일",
    auto_company_research: "자동 회사 조사",
    webform_generation: "웹폼 생성",
    dashboard_generation: "대시보드 생성",
    widget_generation: "위젯 생성",
    alimtalk_generation: "알림톡 생성",
    product_generation: "제품 조사",
    company_research: "회사 조사",
};

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return String(tokens);
}

export default function AiUsageTab() {
    const { usage, isLoading } = useAiUsage();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                로딩 중...
            </div>
        );
    }

    if (!usage) {
        return (
            <div className="text-muted-foreground py-8 text-center">
                사용량 데이터를 불러올 수 없습니다.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>AI 사용량</CardTitle>
                    <CardDescription>
                        {usage.month} 월간 토큰 사용량입니다. AI 기능은 서버에서 관리됩니다.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">사용량</span>
                            <span className="font-medium">
                                {formatTokens(usage.totalTokens)} / {formatTokens(usage.quotaLimit)}
                            </span>
                        </div>
                        <Progress value={usage.usagePercent} className="h-3" />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{usage.usagePercent.toFixed(1)}% 사용</span>
                            <span>잔여 {formatTokens(usage.remaining)}</span>
                        </div>
                    </div>

                    {usage.breakdown.length > 0 && (
                        <div className="space-y-3">
                            <h4 className="text-sm font-medium">용도별 사용량</h4>
                            <div className="space-y-2">
                                {usage.breakdown.map((item) => (
                                    <div
                                        key={item.purpose}
                                        className="flex items-center justify-between text-sm"
                                    >
                                        <span className="text-muted-foreground">
                                            {PURPOSE_LABELS[item.purpose] || item.purpose}
                                        </span>
                                        <span className="font-mono tabular-nums">
                                            {formatTokens(item.tokens)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">AI 설정 안내</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        AI 기능은 서버에서 자동으로 제공됩니다. 별도의 API 키 설정이 필요 없습니다.
                        사용량 한도는 현재 구독 플랜에 따라 결정됩니다.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
