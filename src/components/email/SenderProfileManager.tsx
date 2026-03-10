"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Star } from "lucide-react";
import { toast } from "sonner";

interface SenderProfile {
    id: number;
    name: string;
    fromName: string;
    fromEmail: string;
    isDefault: boolean;
}

interface SenderProfileManagerProps {
    profiles: SenderProfile[];
    createProfile: (data: { name: string; fromName: string; fromEmail: string }) => Promise<{ success: boolean; error?: string }>;
    updateProfile: (id: number, data: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
    deleteProfile: (id: number) => Promise<{ success: boolean; error?: string }>;
}

export default function SenderProfileManager({
    profiles,
    createProfile,
    updateProfile,
    deleteProfile,
}: SenderProfileManagerProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState({ name: "", fromName: "", fromEmail: "" });
    const [saving, setSaving] = useState(false);

    const openNew = () => {
        setEditingId(null);
        setForm({ name: "", fromName: "", fromEmail: "" });
        setDialogOpen(true);
    };

    const openEdit = (p: SenderProfile) => {
        setEditingId(p.id);
        setForm({ name: p.name, fromName: p.fromName, fromEmail: p.fromEmail });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.name || !form.fromName || !form.fromEmail) {
            toast.error("모든 필드를 입력해주세요.");
            return;
        }
        setSaving(true);
        const result = editingId
            ? await updateProfile(editingId, form)
            : await createProfile(form);
        setSaving(false);
        if (result.success) {
            toast.success(editingId ? "프로필이 수정되었습니다." : "프로필이 추가되었습니다.");
            setDialogOpen(false);
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

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>발신자 프로필</CardTitle>
                            <CardDescription>발신 이름과 이메일 쌍을 여러 개 관리합니다.</CardDescription>
                        </div>
                        <Button size="sm" onClick={openNew}>
                            <Plus className="h-4 w-4 mr-1" />
                            추가
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {profiles.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            발신자 프로필이 없습니다. 추가 버튼을 눌러 생성하세요.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {profiles.map((p) => (
                                <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm">{p.name}</span>
                                                {p.isDefault && <Badge variant="secondary" className="text-xs">기본</Badge>}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {p.fromName} &lt;{p.fromEmail}&gt;
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {!p.isDefault && (
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSetDefault(p.id)} title="기본으로 설정">
                                                <Star className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingId ? "발신자 프로필 수정" : "발신자 프로필 추가"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>프로필 이름</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                                placeholder="예: 마케팅팀"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>발신 이름</Label>
                            <Input
                                value={form.fromName}
                                onChange={(e) => setForm((p) => ({ ...p, fromName: e.target.value }))}
                                placeholder="예: SalesFlow 마케팅"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>발신 이메일</Label>
                            <Input
                                type="email"
                                value={form.fromEmail}
                                onChange={(e) => setForm((p) => ({ ...p, fromEmail: e.target.value }))}
                                placeholder="예: marketing@company.com"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>취소</Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editingId ? "수정" : "추가"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
