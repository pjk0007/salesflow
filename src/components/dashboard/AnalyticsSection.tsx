import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { MessageSquare, Mail, TrendingUp, BarChart3 } from "lucide-react";
import { useAnalytics } from "@/hooks/useAnalytics";
import type { Period } from "@/hooks/useAnalytics";
import TrendChart from "./TrendChart";
import TemplateRanking from "./TemplateRanking";

export default function AnalyticsSection() {
    const [period, setPeriod] = useState<Period>("30d");
    const [channel, setChannel] = useState("all");
    const { trends, summary, templates, isLoading } = useAnalytics(period, channel);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    발송 분석
                </h2>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                        {(["7d", "30d", "90d"] as const).map((p) => (
                            <Button
                                key={p}
                                variant={period === p ? "default" : "outline"}
                                size="sm"
                                onClick={() => setPeriod(p)}
                            >
                                {p === "7d" ? "7일" : p === "30d" ? "30일" : "90일"}
                            </Button>
                        ))}
                    </div>
                    <Select value={channel} onValueChange={setChannel}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">전체</SelectItem>
                            <SelectItem value="alimtalk">알림톡</SelectItem>
                            <SelectItem value="email">이메일</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">알림톡</p>
                                <p className="text-2xl font-bold text-green-600">
                                    {isLoading ? "-" : summary.alimtalk.total.toLocaleString()}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    성공 {summary.alimtalk.sent} · 실패 {summary.alimtalk.failed}
                                    {summary.alimtalk.total > 0 &&
                                        ` · ${Math.round((summary.alimtalk.sent / summary.alimtalk.total) * 100)}%`}
                                </p>
                            </div>
                            <MessageSquare className="h-8 w-8 text-green-600 opacity-20" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">이메일</p>
                                <p className="text-2xl font-bold text-blue-600">
                                    {isLoading ? "-" : summary.email.total.toLocaleString()}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    성공 {summary.email.sent} · 실패 {summary.email.failed}
                                    {summary.email.total > 0 &&
                                        ` · ${Math.round((summary.email.sent / summary.email.total) * 100)}%`}
                                </p>
                            </div>
                            <Mail className="h-8 w-8 text-blue-600 opacity-20" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs text-muted-foreground">신규 레코드</p>
                                <p className="text-2xl font-bold text-purple-600">
                                    {isLoading ? "-" : summary.newRecordsInPeriod.toLocaleString()}
                                </p>
                                <p className="text-xs text-muted-foreground">선택 기간 내</p>
                            </div>
                            <TrendingUp className="h-8 w-8 text-purple-600 opacity-20" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">일별 발송 추이</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
                            로딩 중...
                        </div>
                    ) : (
                        <TrendChart data={trends} channel={channel} />
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">발송 규칙별 성과 (Top 10)</CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <p className="text-sm text-muted-foreground text-center py-6">로딩 중...</p>
                    ) : (
                        <TemplateRanking data={templates} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
