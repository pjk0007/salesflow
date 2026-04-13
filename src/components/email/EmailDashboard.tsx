"use client";

import { useMemo, useState } from "react";
import { useEmailConfig } from "@/hooks/useEmailConfig";
import { useEmailAnalytics } from "@/hooks/useEmailAnalytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Mail,
    CheckCircle2,
    XCircle,
    Clock,
    Eye,
    MousePointerClick,
    Settings,
    Loader2,
} from "lucide-react";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
} from "recharts";

interface EmailDashboardProps {
    onTabChange?: (tab: string) => void;
}

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동 발송",
    on_create: "자동화 (생성)",
    on_update: "자동화 (수정)",
    repeat: "반복 발송",
    auto_personalized: "AI 자동발송",
    unknown: "기타",
};

const PERIOD_PRESETS = [
    { label: "7일", days: 7 },
    { label: "30일", days: 30 },
    { label: "90일", days: 90 },
];

function formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

export default function EmailDashboard({ onTabChange }: EmailDashboardProps) {
    const { isConfigured } = useEmailConfig();
    const [periodDays, setPeriodDays] = useState(30);

    const { startDate, endDate } = useMemo(() => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - periodDays);
        return { startDate: formatDate(start), endDate: formatDate(end) };
    }, [periodDays]);

    const { summary, trends, isLoading } = useEmailAnalytics(startDate, endDate);

    if (!isConfigured) {
        return (
            <div className="flex flex-col items-center justify-center p-12">
                <Settings className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">이메일 설정이 필요합니다</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    NHN Cloud Email API 키를 등록하여 이메일 서비스를 시작하세요.
                </p>
                <Button onClick={() => onTabChange?.("settings")}>
                    설정으로 이동
                </Button>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                로딩 중...
            </div>
        );
    }

    const email = summary?.email;
    const triggerBreakdown = summary?.triggerBreakdown ?? [];

    const cards = [
        { label: "전체 발송", value: email?.total ?? 0, icon: Mail, color: "text-blue-600" },
        {
            label: "성공",
            value: email?.sent ?? 0,
            sub: email && email.total > 0 ? `${((email.sent / email.total) * 100).toFixed(1)}%` : undefined,
            icon: CheckCircle2,
            color: "text-green-600",
        },
        {
            label: "실패",
            value: email?.failed ?? 0,
            sub: email && email.total > 0 ? `${((email.failed / email.total) * 100).toFixed(1)}%` : undefined,
            icon: XCircle,
            color: "text-red-600",
        },
        { label: "대기", value: email?.pending ?? 0, icon: Clock, color: "text-yellow-600" },
        {
            label: "읽음률",
            value: email ? `${email.openRate}%` : "0%",
            sub: email ? `${email.opened}/${email.sent}` : undefined,
            icon: Eye,
            color: "text-purple-600",
        },
        {
            label: "클릭률",
            value: email ? `${email.clickRate}%` : "0%",
            sub: email ? `${email.clicked}/${email.opened}` : undefined,
            icon: MousePointerClick,
            color: "text-blue-500",
        },
    ];

    return (
        <div className="space-y-6">
            {/* 기간 선택 */}
            <div className="flex items-center gap-2">
                {PERIOD_PRESETS.map((preset) => (
                    <Button
                        key={preset.days}
                        variant={periodDays === preset.days ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPeriodDays(preset.days)}
                    >
                        {preset.label}
                    </Button>
                ))}
            </div>

            {/* 요약 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {cards.map((card) => (
                    <Card key={card.label}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                                {card.label}
                            </CardTitle>
                            <card.icon className={`h-4 w-4 ${card.color}`} />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{card.value}</div>
                            {card.sub && (
                                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                            )}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* triggerType별 성과 테이블 */}
            {triggerBreakdown.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">발송 유형별 성과</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>발송 유형</TableHead>
                                    <TableHead className="text-right">발송</TableHead>
                                    <TableHead className="text-right">성공</TableHead>
                                    <TableHead className="text-right">실패</TableHead>
                                    <TableHead className="text-right">성공률</TableHead>
                                    <TableHead className="text-right">읽음률</TableHead>
                                    <TableHead className="text-right">클릭률</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {triggerBreakdown.map((row) => (
                                    <TableRow key={row.triggerType}>
                                        <TableCell className="font-medium">
                                            {TRIGGER_LABELS[row.triggerType] || row.triggerType}
                                        </TableCell>
                                        <TableCell className="text-right">{row.total}</TableCell>
                                        <TableCell className="text-right">{row.sent}</TableCell>
                                        <TableCell className="text-right">{row.failed}</TableCell>
                                        <TableCell className="text-right">{row.successRate}%</TableCell>
                                        <TableCell className="text-right">{row.openRate}%</TableCell>
                                        <TableCell className="text-right">{row.clickRate}%</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* 일별 추세 차트 */}
            {trends.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">일별 추세</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={trends}>
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={(d: string) => d.slice(5)}
                                    fontSize={12}
                                />
                                <YAxis fontSize={12} />
                                <Tooltip />
                                <Legend />
                                <Line
                                    type="monotone"
                                    dataKey="emailSent"
                                    name="발송"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    dot={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="emailOpened"
                                    name="읽음"
                                    stroke="#8b5cf6"
                                    strokeWidth={2}
                                    dot={false}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="emailFailed"
                                    name="실패"
                                    stroke="#ef4444"
                                    strokeWidth={2}
                                    dot={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            )}

            {/* 네비게이션 버튼 */}
            <div className="flex gap-3">
                <Button variant="outline" onClick={() => onTabChange?.("templates")}>
                    템플릿 관리
                </Button>
                <Button variant="outline" onClick={() => onTabChange?.("links")}>
                    연결 관리
                </Button>
                <Button variant="outline" onClick={() => onTabChange?.("logs")}>
                    발송 이력
                </Button>
            </div>
        </div>
    );
}
