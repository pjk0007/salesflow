import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from "recharts";
import type { TrendItem } from "@/hooks/useAnalytics";

interface TrendChartProps {
    data: TrendItem[];
    channel: string;
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TrendChart({ data, channel }: TrendChartProps) {
    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
                해당 기간의 발송 이력이 없습니다.
            </div>
        );
    }

    const showAlimtalk = channel !== "email";
    const showEmail = channel !== "alimtalk";

    return (
        <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    className="text-xs"
                />
                <YAxis className="text-xs" allowDecimals={false} />
                <Tooltip
                    labelFormatter={(label) => new Date(label as string).toLocaleDateString("ko-KR")}
                    formatter={(value, name) => [`${value}건`, name]}
                />
                <Legend />
                {showAlimtalk && (
                    <>
                        <Area
                            type="monotone"
                            dataKey="alimtalkSent"
                            name="알림톡 성공"
                            stackId="alimtalk"
                            stroke="#22c55e"
                            fill="#22c55e"
                            fillOpacity={0.3}
                        />
                        <Area
                            type="monotone"
                            dataKey="alimtalkFailed"
                            name="알림톡 실패"
                            stackId="alimtalk"
                            stroke="#ef4444"
                            fill="#ef4444"
                            fillOpacity={0.3}
                        />
                    </>
                )}
                {showEmail && (
                    <>
                        <Area
                            type="monotone"
                            dataKey="emailSent"
                            name="이메일 성공"
                            stackId="email"
                            stroke="#3b82f6"
                            fill="#3b82f6"
                            fillOpacity={0.3}
                        />
                        <Area
                            type="monotone"
                            dataKey="emailFailed"
                            name="이메일 실패"
                            stackId="email"
                            stroke="#f97316"
                            fill="#f97316"
                            fillOpacity={0.3}
                        />
                    </>
                )}
            </AreaChart>
        </ResponsiveContainer>
    );
}
