import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts";

interface StackedBarChartProps {
    data: Array<{ label: string; stack: string; value: number }>;
}

const COLORS = [
    "hsl(var(--chart-1, 220 70% 50%))",
    "hsl(var(--chart-2, 160 60% 45%))",
    "hsl(var(--chart-3, 30 80% 55%))",
    "hsl(var(--chart-4, 280 65% 60%))",
    "hsl(var(--chart-5, 340 75% 55%))",
];

export default function StackedBarChart({ data }: StackedBarChartProps) {
    // 스택 카테고리 추출
    const stackKeys = [...new Set(data.map((d) => d.stack ?? "(없음)"))];

    // 피벗: label별로 각 stack값을 컬럼으로
    const pivotMap = new Map<string, Record<string, number>>();
    for (const d of data) {
        const label = d.label ?? "(없음)";
        const stack = d.stack ?? "(없음)";
        if (!pivotMap.has(label)) pivotMap.set(label, { name: 0 });
        const row = pivotMap.get(label)!;
        row[stack] = Number(d.value);
    }

    const chartData = Array.from(pivotMap.entries()).map(([label, row]) => ({
        name: label,
        ...row,
    }));

    return (
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {stackKeys.map((key, i) => (
                    <Bar
                        key={key}
                        dataKey={key}
                        stackId="a"
                        fill={COLORS[i % COLORS.length]}
                    />
                ))}
            </BarChart>
        </ResponsiveContainer>
    );
}
