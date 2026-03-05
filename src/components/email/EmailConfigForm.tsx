import { useState, useEffect } from "react";
import { useEmailConfig } from "@/hooks/useEmailConfig";
import { useSenderProfiles } from "@/hooks/useSenderProfiles";
import { useSignatures } from "@/hooks/useSignatures";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Loader2, Plus, X, Pencil, Trash2, Star } from "lucide-react";
import { toast } from "sonner";

export interface SignatureData {
    name?: string;
    title?: string;
    company?: string;
    phone?: string;
    email?: string;
    websites?: string[];
    extra?: string;
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

export default function EmailConfigForm() {
    const { config, isLoading: configLoading, saveConfig, testConnection } = useEmailConfig();
    const { profiles, createProfile, updateProfile, deleteProfile, isLoading: profilesLoading } = useSenderProfiles();
    const { signatures, createSignature, updateSignature, deleteSignature, isLoading: signaturesLoading } = useSignatures();

    const [appKey, setAppKey] = useState("");
    const [secretKey, setSecretKey] = useState("");
    const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
    const [saving, setSaving] = useState(false);

    // Sender Profile Dialog
    const [profileDialogOpen, setProfileDialogOpen] = useState(false);
    const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
    const [profileForm, setProfileForm] = useState({ name: "", fromName: "", fromEmail: "" });
    const [profileSaving, setProfileSaving] = useState(false);

    // Signature Dialog
    const [sigDialogOpen, setSigDialogOpen] = useState(false);
    const [editingSigId, setEditingSigId] = useState<number | null>(null);
    const [sigForm, setSigForm] = useState({ name: "", sig: {} as SignatureData });
    const [sigSaving, setSigSaving] = useState(false);

    useEffect(() => {
        if (config) {
            setAppKey(config.appKey);
        }
    }, [config]);

    const handleTest = async () => {
        if (!appKey || !secretKey) {
            toast.error("appKey와 secretKey를 입력해주세요.");
            return;
        }
        setTestStatus("testing");
        const result = await testConnection({ appKey, secretKey });
        setTestStatus(result.success ? "success" : "fail");
        if (result.success) toast.success("연결 성공!");
        else toast.error(result.error || "연결 테스트에 실패했습니다.");
    };

    const handleSave = async () => {
        if (!appKey || !secretKey) {
            toast.error("appKey와 secretKey를 입력해주세요.");
            return;
        }
        setSaving(true);
        const result = await saveConfig({
            appKey,
            secretKey,
            fromName: config?.fromName || undefined,
            fromEmail: config?.fromEmail || undefined,
            signature: config?.signature || undefined,
            signatureEnabled: config?.signatureEnabled,
        });
        setSaving(false);
        if (result.success) toast.success("API 설정이 저장되었습니다.");
        else toast.error(result.error || "저장에 실패했습니다.");
    };

    // === Sender Profile handlers ===
    const openNewProfile = () => {
        setEditingProfileId(null);
        setProfileForm({ name: "", fromName: "", fromEmail: "" });
        setProfileDialogOpen(true);
    };

    const openEditProfile = (p: typeof profiles[0]) => {
        setEditingProfileId(p.id);
        setProfileForm({ name: p.name, fromName: p.fromName, fromEmail: p.fromEmail });
        setProfileDialogOpen(true);
    };

    const handleSaveProfile = async () => {
        if (!profileForm.name || !profileForm.fromName || !profileForm.fromEmail) {
            toast.error("모든 필드를 입력해주세요.");
            return;
        }
        setProfileSaving(true);
        const result = editingProfileId
            ? await updateProfile(editingProfileId, profileForm)
            : await createProfile(profileForm);
        setProfileSaving(false);
        if (result.success) {
            toast.success(editingProfileId ? "프로필이 수정되었습니다." : "프로필이 추가되었습니다.");
            setProfileDialogOpen(false);
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    const handleDeleteProfile = async (id: number) => {
        const result = await deleteProfile(id);
        if (result.success) toast.success("프로필이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    const handleSetDefaultProfile = async (id: number) => {
        const result = await updateProfile(id, { isDefault: true });
        if (result.success) toast.success("기본 프로필로 설정되었습니다.");
    };

    // === Signature handlers ===
    const openNewSig = () => {
        setEditingSigId(null);
        setSigForm({ name: "", sig: {} });
        setSigDialogOpen(true);
    };

    const openEditSig = (s: typeof signatures[0]) => {
        setEditingSigId(s.id);
        setSigForm({ name: s.name, sig: parseSignature(s.signature) });
        setSigDialogOpen(true);
    };

    const handleSaveSig = async () => {
        if (!sigForm.name) {
            toast.error("서명 이름을 입력해주세요.");
            return;
        }
        setSigSaving(true);
        const sigJson = JSON.stringify(sigForm.sig);
        const result = editingSigId
            ? await updateSignature(editingSigId, { name: sigForm.name, signature: sigJson })
            : await createSignature({ name: sigForm.name, signature: sigJson });
        setSigSaving(false);
        if (result.success) {
            toast.success(editingSigId ? "서명이 수정되었습니다." : "서명이 추가되었습니다.");
            setSigDialogOpen(false);
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    const handleDeleteSig = async (id: number) => {
        const result = await deleteSignature(id);
        if (result.success) toast.success("서명이 삭제되었습니다.");
        else toast.error(result.error || "삭제에 실패했습니다.");
    };

    const handleSetDefaultSig = async (id: number) => {
        const result = await updateSignature(id, { isDefault: true });
        if (result.success) toast.success("기본 서명으로 설정되었습니다.");
    };

    const updateSigField = (field: keyof SignatureData, value: string) => {
        setSigForm((prev) => ({ ...prev, sig: { ...prev.sig, [field]: value } }));
    };

    const addWebsite = () => {
        setSigForm((prev) => ({ ...prev, sig: { ...prev.sig, websites: [...(prev.sig.websites || []), ""] } }));
    };

    const updateWebsite = (index: number, value: string) => {
        setSigForm((prev) => {
            const websites = [...(prev.sig.websites || [])];
            websites[index] = value;
            return { ...prev, sig: { ...prev.sig, websites } };
        });
    };

    const removeWebsite = (index: number) => {
        setSigForm((prev) => {
            const websites = [...(prev.sig.websites || [])];
            websites.splice(index, 1);
            return { ...prev, sig: { ...prev.sig, websites } };
        });
    };

    if (configLoading || profilesLoading || signaturesLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* NHN Cloud API 설정 */}
            <Card>
                <CardHeader>
                    <CardTitle>NHN Cloud Email API</CardTitle>
                    <CardDescription>
                        NHN Cloud Email 서비스의 API 키를 입력해주세요.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email-appKey">App Key</Label>
                        <Input
                            id="email-appKey"
                            value={appKey}
                            onChange={(e) => { setAppKey(e.target.value); setTestStatus("idle"); }}
                            placeholder="NHN Cloud Email App Key"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email-secretKey">Secret Key</Label>
                        <Input
                            id="email-secretKey"
                            type="password"
                            value={secretKey}
                            onChange={(e) => { setSecretKey(e.target.value); setTestStatus("idle"); }}
                            placeholder={config ? "변경하려면 새 Secret Key 입력" : "NHN Cloud Secret Key"}
                        />
                        {config && !secretKey && (
                            <p className="text-xs text-muted-foreground">현재 설정됨: {config.secretKey}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                        <Button variant="outline" onClick={handleTest} disabled={testStatus === "testing" || !appKey || !secretKey}>
                            {testStatus === "testing" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {testStatus === "success" && <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />}
                            {testStatus === "fail" && <XCircle className="h-4 w-4 mr-2 text-red-500" />}
                            연결 테스트
                        </Button>
                        <Button onClick={handleSave} disabled={saving || !appKey || !secretKey}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* 발신자 프로필 관리 */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>발신자 프로필</CardTitle>
                            <CardDescription>발신 이름과 이메일 쌍을 여러 개 관리합니다.</CardDescription>
                        </div>
                        <Button size="sm" onClick={openNewProfile}>
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
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSetDefaultProfile(p.id)} title="기본으로 설정">
                                                <Star className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditProfile(p)}>
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteProfile(p.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* 서명 관리 */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>이메일 서명</CardTitle>
                            <CardDescription>이메일 하단에 추가되는 서명을 여러 개 관리합니다.</CardDescription>
                        </div>
                        <Button size="sm" onClick={openNewSig}>
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
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleSetDefaultSig(s.id)} title="기본으로 설정">
                                                    <Star className="h-4 w-4" />
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditSig(s)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteSig(s.id)}>
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

            {/* 발신자 프로필 Dialog */}
            <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingProfileId ? "발신자 프로필 수정" : "발신자 프로필 추가"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>프로필 이름</Label>
                            <Input
                                value={profileForm.name}
                                onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                                placeholder="예: 마케팅팀"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>발신 이름</Label>
                            <Input
                                value={profileForm.fromName}
                                onChange={(e) => setProfileForm((p) => ({ ...p, fromName: e.target.value }))}
                                placeholder="예: SalesFlow 마케팅"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>발신 이메일</Label>
                            <Input
                                type="email"
                                value={profileForm.fromEmail}
                                onChange={(e) => setProfileForm((p) => ({ ...p, fromEmail: e.target.value }))}
                                placeholder="예: marketing@company.com"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setProfileDialogOpen(false)}>취소</Button>
                        <Button onClick={handleSaveProfile} disabled={profileSaving}>
                            {profileSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editingProfileId ? "수정" : "추가"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* 서명 Dialog */}
            <Dialog open={sigDialogOpen} onOpenChange={setSigDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingSigId ? "서명 수정" : "서명 추가"}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>서명 이름</Label>
                            <Input
                                value={sigForm.name}
                                onChange={(e) => setSigForm((p) => ({ ...p, name: e.target.value }))}
                                placeholder="예: 공식 서명"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>이름</Label>
                                <Input
                                    value={sigForm.sig.name || ""}
                                    onChange={(e) => updateSigField("name", e.target.value)}
                                    placeholder="홍길동"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>직책</Label>
                                <Input
                                    value={sigForm.sig.title || ""}
                                    onChange={(e) => updateSigField("title", e.target.value)}
                                    placeholder="영업팀 매니저"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>회사</Label>
                                <Input
                                    value={sigForm.sig.company || ""}
                                    onChange={(e) => updateSigField("company", e.target.value)}
                                    placeholder="SalesFlow Inc."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>전화번호</Label>
                                <Input
                                    value={sigForm.sig.phone || ""}
                                    onChange={(e) => updateSigField("phone", e.target.value)}
                                    placeholder="010-1234-5678"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>이메일 주소</Label>
                            <Input
                                type="email"
                                value={sigForm.sig.email || ""}
                                onChange={(e) => updateSigField("email", e.target.value)}
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
                            {(sigForm.sig.websites || []).map((url, i) => (
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
                                value={sigForm.sig.extra || ""}
                                onChange={(e) => updateSigField("extra", e.target.value)}
                                placeholder="서울시 강남구 테헤란로 123"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSigDialogOpen(false)}>취소</Button>
                        <Button onClick={handleSaveSig} disabled={sigSaving}>
                            {sigSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            {editingSigId ? "수정" : "추가"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
