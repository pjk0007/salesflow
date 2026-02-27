interface ScorecardChartProps {
    data: { value: number } | null;
    aggregation: string;
}

export default function ScorecardChart({ data, aggregation }: ScorecardChartProps) {
    const value = data?.value ?? 0;
    const formatted =
        aggregation === "count"
            ? value.toLocaleString()
            : aggregation === "avg"
              ? value.toFixed(1)
              : value.toLocaleString();

    return (
        <div className="flex items-center justify-center h-full">
            <span className="text-4xl font-bold tabular-nums">{formatted}</span>
        </div>
    );
}
