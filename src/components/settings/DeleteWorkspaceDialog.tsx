import useSWR from "swr";
import { AsyncAlertDialog } from "@/components/ui/alert-dialog";
import { defaultFetcher } from "@/lib/swr-fetcher";
import { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { Button } from "@/components/ui/button";
import { EyeOff } from "lucide-react";

interface DeleteWorkspaceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    workspace: { id: number; name: string } | null;
    onConfirm: () => Promise<void>;
    /** 데이터를 남기고 목록에서만 감추는 대안(UX-034). 이미 숨긴 워크스페이스면 넘기지 않는다 */
    onHide?: () => void;
}

export default function DeleteWorkspaceDialog({
    open,
    onOpenChange,
    workspace,
    onConfirm,
    onHide,
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
                {stats && (stats.partitionCount > 0 || stats.recordCount > 0) && <p className="text-destructive font-medium">파티션 {stats.partitionCount}개, 레코드 {stats.recordCount}개가 삭제됩니다.</p>}
            </div>}
            onConfirm={onConfirm}
            confirmDisabled={!stats}
        >
            {/* 설명(aria-describedby) 밖에 두어 "다시 시도" 버튼까지 설명으로 읽히지 않게 한다 */}
            {error && !stats && <QueryErrorState error={error} onRetry={() => mutate()} />}
            {onHide && (
                <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-muted-foreground">상담·메일 기록이 남아 있으면 삭제되지 않습니다. 데이터를 남기고 목록에서만 감추려면 숨기기를 사용하세요.</p>
                    <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onHide}>
                        <EyeOff className="h-4 w-4 mr-1" />삭제 대신 숨기기
                    </Button>
                </div>
            )}
        </AsyncAlertDialog>
    );
}
