import { useState } from "react";
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
import type { CreateFolderInput } from "@/types";

interface CreateFolderDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: CreateFolderInput) => Promise<{ success: boolean; error?: string }>;
}

export default function CreateFolderDialog({
    open,
    onOpenChange,
    onSubmit,
}: CreateFolderDialogProps) {
    const [name, setName] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleOpenChange = (open: boolean) => {
        if (!open) setName("");
        onOpenChange(open);
    };

    const handleSubmit = async () => {
        if (isSubmitting) return;
        if (!name.trim()) {
            toast.error("이름을 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await onSubmit({ name: name.trim() });
            if (result.success) {
                toast.success("폴더가 생성되었습니다.");
                setName("");
                onOpenChange(false);
            } else {
                toast.error(result.error || "생성에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-sm">
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <DialogHeader>
                        <DialogTitle>새 폴더</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-1.5 py-4">
                        <Label>
                            이름 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="폴더 이름"
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            취소
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "생성 중..." : "생성"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
