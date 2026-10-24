import { AsyncAlertDialog } from "@/components/ui/alert-dialog";
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
    if (!field) return null;

    return (
        <AsyncAlertDialog open={open} onOpenChange={onOpenChange}
            title="속성 삭제"
            description={<div className="space-y-2"><p>&quot;{field.label}&quot; 속성을 삭제합니다.</p><p>이 속성의 기존 레코드 데이터는 테이블에서 더 이상 표시되지 않습니다.</p></div>}
            onConfirm={async () => {
                const result = await onConfirm(field.id);
                if (!result.success) throw new Error(result.error || "삭제에 실패했습니다.");
                toast.success("속성이 삭제되었습니다.");
            }}
        />
    );
}
