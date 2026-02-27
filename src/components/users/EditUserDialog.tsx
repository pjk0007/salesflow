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
import type { UserListItem, UpdateUserInput } from "@/types";

interface EditUserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user: UserListItem | null;
    onSubmit: (id: string, data: UpdateUserInput) => Promise<{ success: boolean; error?: string }>;
}

export default function EditUserDialog({
    open,
    onOpenChange,
    user,
    onSubmit,
}: EditUserDialogProps) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (user) {
            setName(user.name);
            setPhone(user.phone || "");
            setErrors({});
        }
    }, [user]);

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        if (!name.trim()) newErrors.name = "이름을 입력해주세요.";
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (!user || !validate()) return;

        setIsSubmitting(true);
        try {
            const result = await onSubmit(user.id, {
                name: name.trim(),
                phone: phone.trim() || undefined,
            });
            if (result.success) {
                toast.success("사용자 정보가 수정되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "수정에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>사용자 정보 수정</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label className="text-muted-foreground">이메일</Label>
                        <Input value={user?.email ?? ""} disabled />
                    </div>

                    <div className="space-y-1.5">
                        <Label>
                            이름 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                setErrors((prev) => ({ ...prev, name: "" }));
                            }}
                            placeholder="이름을 입력하세요"
                        />
                        {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <Label>전화번호</Label>
                        <Input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="전화번호를 입력하세요"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? "수정 중..." : "수정"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
