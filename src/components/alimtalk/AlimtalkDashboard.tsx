import { useState } from "react";
import { useAlimtalkStats } from "@/hooks/useAlimtalkStats";
import { useAlimtalkConfig } from "@/hooks/useAlimtalkConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Send, CheckCircle2, XCircle, Clock, Settings } from "lucide-react";

interface AlimtalkDashboardProps {
    onTabChange?: (tab: string) => void;
}

export default function AlimtalkDashboard({ onTabChange }: AlimtalkDashboardProps) {
    const { isConfigured } = useAlimtalkConfig();
    const [period, setPeriod] = useState<"today" | "week" | "month">("today");
    const { stats, isLoading } = useAlimtalkStats(period);

    if (!isConfigured) {
        return (
            <div className="flex flex-col items-center justify-center p-12">
                <Settings className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">알림톡 설정이 필요합니다</h3>
                <p className="text-sm text-muted-foreground mb-4">
                    NHN Cloud API 키를 등록하여 알림톡 서비스를 시작하세요.
                </p>
                <Button onClick={() => onTabChange?.("settings")}>
                    설정으로 이동
                </Button>
            </div>
        );
    }

    const cards = [
        { label: "전체 발송", value: stats.total, icon: Send, color: "text-blue-600" },
        { label: "성공", value: stats.sent, icon: CheckCircle2, color: "text-green-600" },
        { label: "실패", value: stats.failed, icon: XCircle, color: "text-red-600" },
        { label: "대기", value: stats.pending, icon: Clock, color: "text-yellow-600" },
    ];

    const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
        pending: { label: "대기", variant: "secondary" },
        sent: { label: "성공", variant: "default" },
        failed: { label: "실패", variant: "destructive" },
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">발송 현황</h3>
                <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
                    <SelectTrigger className="w-[130px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="today">오늘</SelectItem>
                        <SelectItem value="week">이번 주</SelectItem>
                        <SelectItem value="month">이번 달</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {cards.map((card) => (
                    <Card key={card.label}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-muted-foreground">{card.label}</p>
                                    <p className={`text-2xl font-bold ${card.color}`}>
                                        {isLoading ? "-" : card.value.toLocaleString()}
                                    </p>
                                </div>
                                <card.icon className={`h-8 w-8 ${card.color} opacity-20`} />
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">최근 발송 이력</CardTitle>
                </CardHeader>
                <CardContent>
                    {stats.recentLogs.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            아직 발송 이력이 없습니다.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>발송일시</TableHead>
                                    <TableHead>수신번호</TableHead>
                                    <TableHead>템플릿</TableHead>
                                    <TableHead>상태</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.recentLogs.map((log) => {
                                    const statusInfo = STATUS_MAP[log.status] || {
                                        label: log.status,
                                        variant: "secondary" as const,
                                    };
                                    return (
                                        <TableRow key={log.id}>
                                            <TableCell className="text-sm">
                                                {new Date(log.sentAt).toLocaleString("ko-KR")}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {log.recipientNo}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {log.templateName || log.templateCode}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={statusInfo.variant}>
                                                    {statusInfo.label}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
