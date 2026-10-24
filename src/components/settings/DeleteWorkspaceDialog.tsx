import useSWR from "swr";
import { AsyncAlertDialog } from "@/components/ui/alert-dialog";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";

interface DeleteWorkspaceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspace: { id: number; name: string } | null;
    onConfirm: () => Promise<void>;
}

export default function DeleteWorkspaceDialog({
    open,
    onOpenChange,
    workspace,
    onConfirm,
}: DeleteWorkspaceDialogProps) {
    const { data, error, mutate } = useSWR<{ success: boolean; data: { partitionCount: number; recordCount: number } }>(
        open && workspace ? `/api/workspaces/${workspace.id}` : null, defaultFetcher,
    );
    const stats = data?.data;

    if (!workspace) return null;

    return (
        <AsyncAlertDialog open={open} onOpenChange={onOpenChange}
            title="워크스페이스 삭제"
            description={<div className="space-y-2">
                <p>&quot;{workspace.name}&quot; 워크스페이스를 삭제합니다. 하위 파티션, 레코드 등 모든 데이터가 영구적으로 삭제됩니다.</p>
                {error && <QueryErrorState error={error} onRetry={() => mutate()} />}
                {stats && (stats.partitionCount > 0 || stats.recordCount > 0) && <p className="text-destructive font-medium">파티션 {stats.partitionCount}개, 레코드 {stats.recordCount}개가 삭제됩니다.</p>}
            </div>}
            onConfirm={onConfirm}
            confirmDisabled={Boolean(error) || !stats}
        />
    );
}
