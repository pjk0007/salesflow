"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";
import { Loader2, Plus, X, Pencil, Trash2, Star } from "lucide-react";
import { toast } from "sonner";

interface SignatureData {
    name?: string;
    title?: string;
    company?: string;
    phone?: string;
    email?: string;
    websites?: string[];
    extra?: string;
}

interface EmailSignature {
    id: number;
    name: string;
    signature: string | null;
    isDefault: boolean;
}

function parseSignature(raw: string | null): SignatureData {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
    } catch {
        if (raw.trim()) return { extra: raw };
    }
    return {};
}

interface SignatureManagerProps {
    signatures: EmailSignature[];
    createSignature: (data: { name: string; signature: string }) => Promise<{ success: boolean; error?: string }>;
    updateSignature: (id: number, data: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
    deleteSignature: (id: number) => Promise<{ success: boolean; error?: string }>;
}

export default function SignatureManager({
    signatures,
    createSignature,
    updateSignature,
    deleteSignature,
}: SignatureManagerProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState({ name: "", sig: {} as SignatureData });
    const [saving, setSaving] = useState(false);
    const { confirm, confirmationDialog } = useAsyncConfirm();

    const openNew = () => {
        setEditingId(null);
        setForm({ name: "", sig: {} });
        setDialogOpen(true);
    };

    const openEdit = (s: EmailSignature) => {
        setEditingId(s.id);
        setForm({ name: s.name, sig: parseSignature(s.signature) });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.name) {
            toast.error("서명 이름을 입력해주세요.");
            return;
        }
        setSaving(true);
        const sigJson = JSON.stringify(form.sig);
        try {
            const result = editingId
                ? await updateSignature(editingId, { name: form.name, signature: sigJson })
                : await createSignature({ name: form.name, signature: sigJson });
            if (result.success) {
                toast.success(editingId ? "서명이 수정되었습니다." : "서명이 추가되었습니다.");
                setDialogOpen(false);
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } catch {
            // 입력은 그대로 두고 저장 중 상태만 푼다 (UX-144)
            toast.error("저장 결과를 확인하지 못했습니다. 목록에서 반영 여부를 확인한 뒤 다시 시도해주세요.");
        } finally {
            setSaving(false);
        }
    };

    // 지우기 전에 대상과 기본 서명 변경을 알린다. 실패하면 창을 유지해 다시 시도할 수 있다 (UX-151)
    const handleDelete = (s: EmailSignature) => {
        // 서버와 같은 규칙: 기본 서명을 지우면 남은 서명 가운데 가장 먼저 만든 것이 기본이 된다 (목록도 만든 순서)
        const nextDefault = s.isDefault ? signatures.find((other) => other.id !== s.id) : undefined;
        const defaultNote = !s.isDefault
            ? ""
            : nextDefault
              ? ` 기본 서명이라 지우면 '${nextDefault.name}'이(가) 기본 서명이 되어 이후 메일의 서명이 바뀝니다.`
              : " 기본 서명이라 지우면 기본 서명이 없어 이후 메일에 서명이 붙지 않습니다.";
        confirm({
            title: "서명 삭제",
            description: `'${s.name}' 서명을 삭제합니다. 되돌릴 수 없습니다.${defaultNote}`,
            onConfirm: async () => {
                let result: { success: boolean; error?: string };
                try {
                    result = await deleteSignature(s.id);
                } catch {
                    throw new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.");
                }
                if (!result.success) throw new Error(result.error || "삭제에 실패했습니다.");
                toast.success("서명이 삭제되었습니다.");
            },
        });
    };

    const handleSetDefault = async (id: number) => {
        try {
            const result = await updateSignature(id, { isDefault: true });
            if (result.success) toast.success("기본 서명으로 설정되었습니다.");
            else toast.error(result.error || "기본 서명 설정에 실패했습니다.");
        } catch {
            toast.error("기본 서명 설정 결과를 확인하지 못했습니다. 다시 시도해주세요.");
        }
    };

    const updateField = (field: keyof SignatureData, value: string) => {
        setForm((prev) => ({ ...prev, sig: { ...prev.sig, [field]: value } }));
    };

    const addWebsite = () => {
        setForm((prev) => ({ ...prev, sig: { ...prev.sig, websites: [...(prev.sig.websites || []), ""] } }));
    };

    const updateWebsite = (index: number, value: string) => {
        setForm((prev) => {
            const websites = [...(prev.sig.websites || [])];
            websites[index] = value;
            return { ...prev, sig: { ...prev.sig, websites } };
        });
    };

    const removeWebsite = (index: number) => {
        setForm((prev) => {
            const websites = [...(prev.sig.websites || [])];
            websites.splice(index, 1);
            return { ...prev, sig: { ...prev.sig, websites } };
        });
    };

    return (
        <>
            {confirmationDialog}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>이메일 서명</CardTitle>
                            <CardDescription>이메일 하단에 추가되는 서명을 여러 개 관리합니다.</CardDescription>
                        </div>
                        <Button size="sm" onClick={openNew}>
                            <Plus className="h-4 w-4 mr-1" />
                            추가
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {signatures.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                            서명이 없습니다. 추가 버튼을 눌러 생성하세요.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {signatures.map((s) => {
                                const parsed = parseSignature(s.signature);
                                const preview = [parsed.name, parsed.title, parsed.company].filter(Boolean).join(" · ") || "서명 내용 없음";
                                return (
                                    <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm">{s.name}</span>
                                                {s.isDefault && <Badge variant="secondary" className="text-xs">기본</Badge>}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5">{preview}</p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {!s.isDefault && (
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSetDefault(s.id)} title="기본으로 설정">
                                                    <Star className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s)} aria-label={`${s.name} 서명 삭제`}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingId ? "서명 수정" : "서명 추가"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>서명 이름</Label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                                placeholder="예: 공식 서명"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>이름</Label>
                                <Input
                                    value={form.sig.name || ""}
                                    onChange={(e) => updateField("name", e.target.value)}
                                    placeholder="홍길동"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>직책</Label>
                                <Input
                                    value={form.sig.title || ""}
                                    onChange={(e) => updateField("title", e.target.value)}
                                    placeholder="영업팀 매니저"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>회사</Label>
                                <Input
                                    value={form.sig.company || ""}
                                    onChange={(e) => updateField("company", e.target.value)}
                                    placeholder="Sendb Inc."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>전화번호</Label>
                                <Input
                                    value={form.sig.phone || ""}
                                    onChange={(e) => updateField("phone", e.target.value)}
                                    placeholder="010-1234-5678"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>이메일 주소</Label>
                            <Input
                                type="email"
                                value={form.sig.email || ""}
                                onChange={(e) => updateField("email", e.target.value)}
                                placeholder="hong@company.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>웹사이트</Label>
                                <Button type="button" variant="ghost" size="sm" onClick={addWebsite}>
                                    <Plus className="h-4 w-4 mr-1" />추가
                                </Button>
                            </div>
                            {(form.sig.websites || []).map((url, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <Input
                                        value={url}
                                        onChange={(e) => updateWebsite(i, e.target.value)}
                                        placeholder="https://company.com"
                                    />
                                    <Button type="button" variant="ghost" size="icon" onClick={() => removeWebsite(i)}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <Label>기타 정보</Label>
                            <Input
                                value={form.sig.extra || ""}
                                onChange={(e) => updateField("extra", e.target.value)}
                                placeholder="서울시 강남구 테헤란로 123"
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
