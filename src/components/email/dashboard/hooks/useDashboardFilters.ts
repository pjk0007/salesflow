import { useState } from "react";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { previousRange } from "@/lib/tracker/date-range";
import { calendarRange, periodRange, pickerDate } from "../utils/period";

export function useDashboardFilters() {
    const [range, setRange] = useState(() => periodRange(30, new Date()));
    const [preset, setPreset] = useState<number | null>(30);
    const [workspaceId, setWorkspaceId] = useState<number | null>(null);
    const { workspaces } = useWorkspaces();
    const comparison = previousRange(range.from, range.to);
    const handleCalendar = (value: {
        from: Date | undefined;
        to: Date | undefined;
    }) => {
        if(!value.from || !value.to)
            return;
        setRange(calendarRange(value.from, value.to));
        setPreset(null);
    };
    return {
        query: { ...range, workspaceId },
        workspaces: workspaces.map(workspace => ({ ...workspace, value: String(workspace.id) })),
        workspaceValue: workspaceId === null ? "all" : String(workspaceId),
        handleWorkspace: (value: string) => setWorkspaceId(value === "all" ? null : Number(value)),
        presets: [7, 30, 90].map(days => ({
            label: `${days}일`,
            selected: days === preset,
            onClick: () => {
                setPreset(days);
                setRange(periodRange(days, new Date()));
            },
        })),
        calendar: {
            from: pickerDate(range.from),
            to: pickerDate(range.to),
            onChange: handleCalendar,
            maxDate: pickerDate(periodRange(1, new Date()).to)
        },
        comparisonText: `${comparison.fromYmd} ~ ${comparison.toYmd} 대비`,
    };
}
export type DashboardFilters = ReturnType<typeof useDashboardFilters>;
