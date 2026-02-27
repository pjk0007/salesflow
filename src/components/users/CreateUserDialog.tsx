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
import type { CreateUserInput, OrgRole } from "@/types";

interface CreateUserDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentUserRole: OrgRole;
    onSubmit: (data: CreateUserInput) => Promise<{ success: boolean; error?: string }>;
}

export default function CreateUserDialog({
    open,
    onOpenChange,
    currentUserRole,
    onSubmit,
}: CreateUserDialogProps) {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [role, setRole] = useState<OrgRole>("member");
    const [phone, setPhone] = useState("");
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const roleOptions: { value: OrgRole; label: string }[] =
        currentUserRole === "owner"
            ? [
                  { value: "member", label: "Member" },
                  { value: "admin", label: "Admin" },
                  { value: "owner", label: "Owner" },
              ]
            : [{ value: "member", label: "Member" }];

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};
        if (!name.trim()) newErrors.name = "이름을 입력해주세요.";
        if (!email.trim()) newErrors.email = "이메일을 입력해주세요.";
        if (!password) newErrors.password = "비밀번호를 입력해주세요.";
        else if (password.length < 6) newErrors.password = "비밀번호는 6자 이상이어야 합니다.";
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (!validate()) return;

        setIsSubmitting(true);
        try {
            const result = await onSubmit({
                name: name.trim(),
                email: email.trim(),
                password,
                role,
                phone: phone.trim() || undefined,
            });
            if (result.success) {
                toast.success("사용자가 등록되었습니다.");
                resetForm();
                onOpenChange(false);
            } else {
                toast.error(result.error || "등록에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        setName("");
        setEmail("");
        setPassword("");
        setRole("member");
        setPhone("");
        setErrors({});
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) resetForm();
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>사용자 추가</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
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
                        <Label>
                            이메일 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            type="email"
                            value={email}
                            onChange={(e) => {
                                setEmail(e.target.value);
                                setErrors((prev) => ({ ...prev, email: "" }));
                            }}
                            placeholder="이메일을 입력하세요"
                        />
                        {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
                    </div>

                    <div className="space-y-1.5">
                        <Label>
                            비밀번호 <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            type="password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setErrors((prev) => ({ ...prev, password: "" }));
                            }}
                            placeholder="6자 이상 입력하세요"
                        />
                        {errors.password && (
                            <p className="text-sm text-destructive">{errors.password}</p>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label>역할</Label>
                        <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {roleOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
                        onClick={() => handleOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? "등록 중..." : "등록"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
