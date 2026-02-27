import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";

interface LineChartWidgetProps {
    data: Array<{ label: string; value: number }>;
}

export default function LineChartWidget({ data }: LineChartWidgetProps) {
    const chartData = data.map((d) => ({
        name: d.label ?? "(없음)",
        value: Number(d.value),
    }));

    return (
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(var(--chart-1, 220 70% 50%))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                />
            </LineChart>
        </ResponsiveContainer>
    );
}
