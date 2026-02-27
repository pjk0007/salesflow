import Link from "next/link";
import AnalyticsSection from "./AnalyticsSection";
import { useDashboardSummary } from "@/hooks/useDashboardSummary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    Users,
    LayoutGrid,
    MessageSquare,
    Mail,
    Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
    pending: { label: "대기", variant: "secondary" },
    sent: { label: "성공", variant: "default" },
    failed: { label: "실패", variant: "destructive" },
    rejected: { label: "거부", variant: "destructive" },
};

function StatCard({
    label,
    value,
    subtitle,
    icon: Icon,
    color,
    isLoading,
}: {
    label: string;
    value: string | number;
    subtitle?: string;
    icon: LucideIcon;
    color: string;
    isLoading?: boolean;
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className={`text-2xl font-bold ${color}`}>
                            {isLoading ? "-" : value}
                        </p>
                        {subtitle && (
                            <p className="text-xs text-muted-foreground">{subtitle}</p>
                        )}
                    </div>
                    <Icon className={`h-8 w-8 ${color} opacity-20`} />
                </div>
            </CardContent>
        </Card>
    );
}

function RecentLogsCard({
    title,
    logs,
    type,
}: {
    title: string;
    logs: Array<{
        id: number;
        status: string;
        sentAt: string;
        recipientNo?: string;
        templateName?: string | null;
        recipientEmail?: string;
        subject?: string | null;
    }>;
    type: "alimtalk" | "email";
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {logs.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                        아직 발송 이력이 없습니다.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>발송일시</TableHead>
                                <TableHead>
                                    {type === "alimtalk" ? "수신번호" : "수신이메일"}
                                </TableHead>
                                <TableHead>
                                    {type === "alimtalk" ? "템플릿" : "제목"}
                                </TableHead>
                                <TableHead>상태</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {logs.map((log) => {
                                const statusInfo = STATUS_MAP[log.status] ?? {
                                    label: log.status,
                                    variant: "secondary" as const,
                                };
                                return (
                                    <TableRow key={log.id}>
                                        <TableCell className="text-sm">
                                            {new Date(log.sentAt).toLocaleString("ko-KR")}
                                        </TableCell>
                                        <TableCell className="text-sm font-mono">
                                            {type === "alimtalk"
                                                ? log.recipientNo
                                                : log.recipientEmail}
                                        </TableCell>
                                        <TableCell className="text-sm truncate max-w-[150px]">
                                            {type === "alimtalk"
                                                ? log.templateName ?? "-"
                                                : log.subject ?? "-"}
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
    );
}

function QuickActions() {
    return (
        <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
                <Link href="/records">
                    <Table2 className="h-4 w-4 mr-2" />
                    레코드 관리
                </Link>
            </Button>
            <Button variant="outline" asChild>
                <Link href="/alimtalk">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    알림톡
                </Link>
            </Button>
            <Button variant="outline" asChild>
                <Link href="/email">
                    <Mail className="h-4 w-4 mr-2" />
                    이메일
                </Link>
            </Button>
        </div>
    );
}

export default function HomeDashboard() {
    const { summary, isLoading } = useDashboardSummary();

    return (
        <div className="space-y-6">
            {/* 통계 카드 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    label="전체 레코드"
                    value={summary.recordCount.toLocaleString()}
                    icon={Users}
                    color="text-blue-600"
                    isLoading={isLoading}
                />
                <StatCard
                    label="워크스페이스"
                    value={summary.workspaceCount}
                    subtitle={`파티션 ${summary.partitionCount}개`}
                    icon={LayoutGrid}
                    color="text-purple-600"
                    isLoading={isLoading}
                />
                <StatCard
                    label="알림톡 (오늘)"
                    value={isLoading ? "-" : `${summary.alimtalk.sent} / ${summary.alimtalk.failed}`}
                    subtitle={`전체 ${summary.alimtalk.total}건`}
                    icon={MessageSquare}
                    color="text-green-600"
                    isLoading={false}
                />
                <StatCard
                    label="이메일 (오늘)"
                    value={isLoading ? "-" : `${summary.email.sent} / ${summary.email.failed}`}
                    subtitle={`전체 ${summary.email.total}건`}
                    icon={Mail}
                    color="text-orange-600"
                    isLoading={false}
                />
            </div>

            {/* 최근 활동 */}
            <div className="grid md:grid-cols-2 gap-6">
                <RecentLogsCard
                    title="최근 알림톡"
                    logs={summary.recentAlimtalkLogs}
                    type="alimtalk"
                />
                <RecentLogsCard
                    title="최근 이메일"
                    logs={summary.recentEmailLogs}
                    type="email"
                />
            </div>

            {/* 빠른 액션 */}
            <QuickActions />

            {/* 발송 분석 */}
            <AnalyticsSection />
        </div>
    );
}
