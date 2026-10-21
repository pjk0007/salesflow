import type { DashboardFilters } from "../hooks/useDashboardFilters";
import { PeriodPicker } from "./PeriodPicker";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { StatsFreshness } from "./StatsFreshness";
export function DashboardToolbar({ filters }: { filters: DashboardFilters }) {
    return <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3"><PeriodPicker filters={filters} /><WorkspaceSelect filters={filters} /></div>
        <p className="text-xs text-muted-foreground">{filters.comparisonText}</p>
        <StatsFreshness query={filters.query} />
    </div>;
}
