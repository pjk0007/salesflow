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

interface DeletePartitionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partition: { id: number; name: string } | null;
    onConfirm: () => Promise<void>;
}

export default function DeletePartitionDialog({
    open,
    onOpenChange,
    partition,
    onConfirm,
}: DeletePartitionDialogProps) {
    const [stats, setStats] = useState<{ recordCount: number } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (open && partition) {
            setStats(null);
            fetch(`/api/partitions/${partition.id}`)
                .then((r) => r.json())
                .then((result) => {
                    if (result.success) {
                        setStats(result.data);
                    }
                })
                .catch(() => {});
        }
    }, [open, partition]);

    const handleConfirm = async () => {
        setIsDeleting(true);
        try {
            await onConfirm();
        } finally {
            setIsDeleting(false);
        }
    };

    if (!partition) return null;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>파티션 삭제</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2">
                            <p>
                                &quot;{partition.name}&quot; 파티션을 삭제합니다.
                                하위 레코드 등 모든 데이터가 영구적으로 삭제됩니다.
                            </p>
                            {stats && stats.recordCount > 0 && (
                                <p className="text-destructive font-medium">
                                    레코드 {stats.recordCount}개가 삭제됩니다.
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
