import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DashboardFilters } from "../hooks/useDashboardFilters";
export function WorkspaceSelect({ filters }: { filters: DashboardFilters }) {
    return <Select value={filters.workspaceValue} onValueChange={filters.handleWorkspace}>
        <SelectTrigger className="w-48" aria-label="워크스페이스"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">전체 사업</SelectItem>
            {filters.workspaces.map(workspace => <SelectItem key={workspace.id} value={workspace.value}>{workspace.name}</SelectItem>)}
        </SelectContent>
    </Select>;
}
