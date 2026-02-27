import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface RenameDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    currentName: string;
    onSubmit: (name: string) => Promise<{ success: boolean; error?: string }>;
}

export default function RenameDialog({
    open,
    onOpenChange,
    title,
    currentName,
    onSubmit,
}: RenameDialogProps) {
    const [name, setName] = useState(currentName);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (open) setName(currentName);
    }, [open, currentName]);

    const handleSubmit = async () => {
        if (isSubmitting) return;
        if (!name.trim()) {
            toast.error("이름을 입력해주세요.");
            return;
        }
        if (name.trim() === currentName) {
            onOpenChange(false);
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit(name.trim());
            if (result.success) {
                toast.success("이름이 변경되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "변경에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm">
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-1.5 py-4">
                        <Label>
                            이름 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="이름"
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "변경 중..." : "변경"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
