import { useState } from "react";
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
import { toast } from "sonner";

interface DeleteFieldDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    field: { id: number; label: string; key: string } | null;
    onConfirm: (id: number) => Promise<{ success: boolean; error?: string }>;
}

export default function DeleteFieldDialog({
    open,
    onOpenChange,
    field,
    onConfirm,
}: DeleteFieldDialogProps) {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleConfirm = async () => {
        if (!field) return;
        setIsDeleting(true);
        try {
            const result = await onConfirm(field.id);
            if (result.success) {
                toast.success("속성이 삭제되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "삭제에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsDeleting(false);
        }
    };

    if (!field) return null;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>속성 삭제</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2">
                            <p>
                                &quot;{field.label}&quot; 속성을 삭제합니다.
                            </p>
                            <p className="text-muted-foreground">
                                이 속성의 기존 레코드 데이터는 테이블에서 더 이상 표시되지 않습니다.
                            </p>
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
