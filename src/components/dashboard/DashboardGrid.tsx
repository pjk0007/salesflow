import { useCallback, useRef } from "react";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout/legacy";
import WidgetCard from "./WidgetCard";
import type { DashboardWidget } from "@/lib/db";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface DashboardGridProps {
    widgets: DashboardWidget[];
    widgetData: Record<number, unknown>;
    isDataLoading: boolean;
    isEditing: boolean;
    onLayoutChange: (layouts: Array<{ id: number; x: number; y: number; w: number; h: number }>) => void;
    onConfigureWidget: (widget: DashboardWidget) => void;
    onDeleteWidget: (widgetId: number) => void;
}

export default function DashboardGrid({
    widgets,
    widgetData,
    isDataLoading,
    isEditing,
    onLayoutChange,
    onConfigureWidget,
    onDeleteWidget,
}: DashboardGridProps) {
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const layout = widgets.map((w) => ({
        i: String(w.id),
        x: w.layoutX,
        y: w.layoutY,
        w: w.layoutW,
        h: w.layoutH,
        minW: 2,
        minH: 2,
        static: !isEditing,
    }));

    const handleLayoutChange = useCallback(
        (newLayout: Layout) => {
            if (!isEditing) return;

            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
                const changes = newLayout.map((l) => ({
                    id: Number(l.i),
                    x: l.x,
                    y: l.y,
                    w: l.w,
                    h: l.h,
                }));
                onLayoutChange(changes);
            }, 500);
        },
        [isEditing, onLayoutChange]
    );

    if (widgets.length === 0) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
                <p>위젯을 추가하세요</p>
            </div>
        );
    }

    return (
        <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: layout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={80}
            isDraggable={isEditing}
            isResizable={isEditing}
            onLayoutChange={handleLayoutChange}
            compactType="vertical"
            margin={[12, 12]}
        >
            {widgets.map((widget) => (
                <div key={String(widget.id)}>
                    <WidgetCard
                        widget={widget}
                        data={widgetData[widget.id]}
                        isLoading={isDataLoading}
                        isEditing={isEditing}
                        onConfigure={() => onConfigureWidget(widget)}
                        onDelete={() => onDeleteWidget(widget.id)}
                    />
                </div>
            ))}
        </ResponsiveGridLayout>
    );
}
