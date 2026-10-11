import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import type { SenderProfile, SenderProfileManagerProps } from "../types/sender-profile";

export function useSenderProfileManager({ createProfile, updateProfile, deleteProfile }: SenderProfileManagerProps) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState({ name: "", fromName: "", fromEmail: "" });
    const [isSaving, setIsSaving] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);

    const handleOpenNew = () => {
        setEditingId(null);
        setForm({ name: "", fromName: "", fromEmail: "" });
        setIsVerified(false);
        setIsDialogOpen(true);
    };

    const handleOpenEdit = (p: SenderProfile) => {
        setEditingId(p.id);
        setForm({ name: p.name, fromName: p.fromName, fromEmail: p.fromEmail });
        setIsVerified(true);
        setIsDialogOpen(true);
    };

    const handleVerify = async () => {
        if (!form.fromEmail || !form.fromEmail.includes("@")) {
            toast.error("유효한 발신 이메일을 입력해주세요.");
            return;
        }
        setIsVerifying(true);
        try {
            const res = await fetch("/api/email/sender-profiles/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fromEmail: form.fromEmail, fromName: form.fromName }),
            });
            const result = await res.json();
            if (result.success) {
                setIsVerified(true);
                toast.success("발신 이메일이 확인되었습니다. 확인 메일이 발송되었습니다.");
            } else {
                toast.error(result.error || "발신 이메일 확인에 실패했습니다.");
            }
        } catch {
            toast.error("요청에 실패했습니다.");
        } finally {
            setIsVerifying(false);
        }
    };

    const handleSave = async () => {
        if (!form.name || !form.fromName || !form.fromEmail) {
            toast.error("모든 필드를 입력해주세요.");
            return;
        }
        setIsSaving(true);
        const result = editingId
            ? await updateProfile(editingId, form)
            : await createProfile(form);
        setIsSaving(false);
        if (result.success) {
            toast.success(editingId ? "프로필이 수정되었습니다." : "프로필이 추가되었습니다.");
            setIsDialogOpen(false);
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    const handleDelete = async (id: number) => {
        const result = await deleteProfile(id);
        if (result.success) toast.success("프로필이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    const handleSetDefault = async (id: number) => {
        const result = await updateProfile(id, { isDefault: true });
        if (result.success) toast.success("기본 프로필로 설정되었습니다.");
    };

    const handleNameChange = (event: ChangeEvent<HTMLInputElement>) => setForm((previous) => ({ ...previous, name: event.target.value }));
    const handleFromNameChange = (event: ChangeEvent<HTMLInputElement>) => setForm((previous) => ({ ...previous, fromName: event.target.value }));
    const handleEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
        setForm((previous) => ({ ...previous, fromEmail: event.target.value }));
        if (!editingId) setIsVerified(false);
    };
    const handleClose = () => setIsDialogOpen(false);
    return { isDialogOpen, setIsDialogOpen, editingId, form, isSaving, isVerifying, isVerified,
        handleOpenNew, handleOpenEdit, handleVerify, handleSave, handleDelete, handleSetDefault,
        handleNameChange, handleFromNameChange, handleEmailChange, handleClose };
}
