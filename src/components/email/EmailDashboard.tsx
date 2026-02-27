import { useEmailConfig } from "@/hooks/useEmailConfig";
import { useEmailLogs } from "@/hooks/useEmailLogs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, CheckCircle2, XCircle, Clock, Settings } from "lucide-react";

interface EmailDashboardProps {
    onTabChange?: (tab: string) => void;
}

export default function EmailDashboard({ onTabChange }: EmailDashboardProps) {
    const { isConfigured } = useEmailConfig();
    const { logs, totalCount } = useEmailLogs();

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

    const sent = logs.filter((l) => l.status === "sent").length;
    const failed = logs.filter((l) => l.status === "failed" || l.status === "rejected").length;
    const pending = logs.filter((l) => l.status === "pending").length;

    const cards = [
        { label: "전체 발송", value: totalCount, icon: Mail, color: "text-blue-600" },
        { label: "성공", value: sent, icon: CheckCircle2, color: "text-green-600" },
        { label: "실패", value: failed, icon: XCircle, color: "text-red-600" },
        { label: "대기", value: pending, icon: Clock, color: "text-yellow-600" },
    ];

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                        </CardContent>
                    </Card>
                ))}
            </div>

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
