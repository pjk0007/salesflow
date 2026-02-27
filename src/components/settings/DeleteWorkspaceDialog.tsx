import { useState, useEffect } from "react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";

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
    const [stats, setStats] = useState<{ partitionCount: number; recordCount: number } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (open && workspace) {
            setStats(null);
            fetch(`/api/workspaces/${workspace.id}`)
                .then((r) => r.json())
                .then((result) => {
                    if (result.success) {
                        setStats(result.data);
                    }
                })
                .catch(() => {});
        }
    }, [open, workspace]);

    const handleConfirm = async () => {
        setIsDeleting(true);
        try {
            await onConfirm();
        } finally {
            setIsDeleting(false);
        }
    };

    if (!workspace) return null;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>워크스페이스 삭제</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2">
                            <p>
                                &quot;{workspace.name}&quot; 워크스페이스를 삭제합니다.
                                하위 파티션, 레코드 등 모든 데이터가 영구적으로 삭제됩니다.
                            </p>
                            {stats && (stats.partitionCount > 0 || stats.recordCount > 0) && (
                                <p className="text-destructive font-medium">
                                    파티션 {stats.partitionCount}개, 레코드 {stats.recordCount}개가 삭제됩니다.
                                </p>
                            )}
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeleting}>취소</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        onClick={handleConfirm}
                        disabled={isDeleting}
                    >
                        {isDeleting ? "삭제 중..." : "삭제"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
