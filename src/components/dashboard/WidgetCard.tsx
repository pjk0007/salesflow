import { Settings, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ScorecardChart from "./charts/ScorecardChart";
import BarChartWidget from "./charts/BarChartWidget";
import LineChartWidget from "./charts/LineChartWidget";
import DonutChart from "./charts/DonutChart";
import StackedBarChart from "./charts/StackedBarChart";
import type { DashboardWidget } from "@/lib/db";

interface WidgetCardProps {
    widget: DashboardWidget;
    data: unknown;
    isLoading: boolean;
    isEditing: boolean;
    onConfigure?: () => void;
    onDelete?: () => void;
}

export default function WidgetCard({
    widget,
    data,
    isLoading,
    isEditing,
    onConfigure,
    onDelete,
}: WidgetCardProps) {
    return (
        <div className="h-full flex flex-col bg-background border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
                <h3 className="text-sm font-medium truncate">{widget.title}</h3>
                {isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={onConfigure}
                        >
                            <Settings className="h-3 w-3" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive"
                            onClick={onDelete}
                        >
                            <X className="h-3 w-3" />
                        </Button>
                    </div>
                )}
            </div>
            <div className="flex-1 p-2 min-h-0">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    renderChart(widget, data)
                )}
            </div>
        </div>
    );
}

function renderChart(widget: DashboardWidget, data: unknown) {
    switch (widget.widgetType) {
        case "scorecard":
            return (
                <ScorecardChart
                    data={data as { value: number } | null}
                    aggregation={widget.aggregation}
                />
            );
        case "bar":
            return (
                <BarChartWidget
                    data={(data as Array<{ label: string; value: number }>) ?? []}
                />
            );
        case "bar_horizontal":
            return (
                <BarChartWidget
                    data={(data as Array<{ label: string; value: number }>) ?? []}
                    horizontal
                />
            );
        case "line":
            return (
                <LineChartWidget
                    data={(data as Array<{ label: string; value: number }>) ?? []}
                />
            );
        case "donut":
            return (
                <DonutChart
                    data={(data as Array<{ label: string; value: number }>) ?? []}
                />
            );
        case "bar_stacked":
            return (
                <StackedBarChart
                    data={
                        (data as Array<{ label: string; stack: string; value: number }>) ?? []
                    }
                />
            );
        default:
            return (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    지원하지 않는 위젯 타입
                </div>
            );
    }
}
