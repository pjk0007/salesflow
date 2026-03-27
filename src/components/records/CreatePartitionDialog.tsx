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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useFieldTypes } from "@/hooks/useFieldTypes";
import type { CreatePartitionInput } from "@/types";

interface CreatePartitionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    folders: { id: number; name: string }[];
    onSubmit: (input: CreatePartitionInput) => Promise<{ success: boolean; error?: string }>;
}

export default function CreatePartitionDialog({
    open,
    onOpenChange,
    folders,
    onSubmit,
}: CreatePartitionDialogProps) {
    const [name, setName] = useState("");
    const [folderId, setFolderId] = useState<string>("");
    const [fieldTypeId, setFieldTypeId] = useState<string>("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { fieldTypes: types } = useFieldTypes();

    const resetForm = () => {
        setName("");
        setFolderId("");
        setFieldTypeId("");
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) resetForm();
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
            const result = await onSubmit({
                name: name.trim(),
                folderId: folderId ? Number(folderId) : null,
                fieldTypeId: fieldTypeId ? Number(fieldTypeId) : undefined,
            });
            if (result.success) {
                toast.success("파티션이 생성되었습니다.");
                resetForm();
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
            <DialogContent className="max-w-md">
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
                    <DialogHeader>
                        <DialogTitle>새 파티션</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-1.5">
                            <Label>
                                이름 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="파티션 이름"
                            />
                        </div>

                        {types.length > 0 && (
                            <div className="space-y-1.5">
                                <Label>속성 타입</Label>
                                <Select value={fieldTypeId} onValueChange={setFieldTypeId}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="워크스페이스 기본 타입 사용" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="default">워크스페이스 기본 타입 사용</SelectItem>
                                        {types.map((t) => (
                                            <SelectItem key={t.id} value={String(t.id)}>
                                                {t.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    미선택 시 워크스페이스의 기본 속성 타입이 적용됩니다.
                                </p>
                            </div>
                        )}

                        {folders.length > 0 && (
                            <div className="space-y-1.5">
                                <Label>폴더</Label>
                                <Select value={folderId} onValueChange={setFolderId}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="미분류" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">미분류</SelectItem>
                                        {folders.map((f) => (
                                            <SelectItem key={f.id} value={String(f.id)}>
                                                {f.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
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
