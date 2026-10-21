import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { DashboardFilters } from "../hooks/useDashboardFilters";
export function PeriodPicker({ filters }: { filters: DashboardFilters }) {
    return <div className="flex flex-wrap items-center gap-2">
        {filters.presets.map(preset => <Button key={preset.label} size="sm" variant={preset.selected ? "default" : "outline"} onClick={preset.onClick}>{preset.label}</Button>)}
        <DateRangePicker {...filters.calendar} />
    </div>;
}
