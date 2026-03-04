import { useState, useEffect } from "react";
import { useEmailConfig } from "@/hooks/useEmailConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, Plus, X } from "lucide-react";
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
        // legacy plain text — migrate to structured
        if (raw.trim()) return { extra: raw };
    }
    return {};
}

export default function EmailConfigForm() {
    const { config, isLoading, saveConfig, testConnection } = useEmailConfig();
    const [appKey, setAppKey] = useState("");
    const [secretKey, setSecretKey] = useState("");
    const [fromName, setFromName] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [sig, setSig] = useState<SignatureData>({});
    const [signatureEnabled, setSignatureEnabled] = useState(false);
    const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
    const [saving, setSaving] = useState(false);
    const [savingSignature, setSavingSignature] = useState(false);

    useEffect(() => {
        if (config) {
            setAppKey(config.appKey);
            setFromName(config.fromName || "");
            setFromEmail(config.fromEmail || "");
            setSig(parseSignature(config.signature));
            setSignatureEnabled(config.signatureEnabled ?? false);
        }
    }, [config]);

    const handleTest = async () => {
        if (!appKey || !secretKey) {
            toast.error("appKey와 secretKey를 입력해주세요.");
            return;
        }
        setTestStatus("testing");
        const result = await testConnection({ appKey, secretKey });
        if (result.success) {
            setTestStatus("success");
            toast.success("연결 성공!");
        } else {
            setTestStatus("fail");
            toast.error(result.error || "연결 테스트에 실패했습니다.");
        }
    };

    const serializeSignature = () => JSON.stringify(sig);

    const handleSave = async () => {
        if (!appKey || !secretKey) {
            toast.error("appKey와 secretKey를 입력해주세요.");
            return;
        }
        setSaving(true);
        const result = await saveConfig({ appKey, secretKey, fromName, fromEmail, signature: serializeSignature(), signatureEnabled });
        setSaving(false);
        if (result.success) {
            toast.success("이메일 설정이 저장되었습니다.");
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    const handleSaveSignature = async () => {
        if (!config) return;
        setSavingSignature(true);
        const result = await saveConfig({
            appKey: config.appKey,
            secretKey: config.secretKey,
            fromName: config.fromName || undefined,
            fromEmail: config.fromEmail || undefined,
            signature: serializeSignature(),
            signatureEnabled,
        });
        setSavingSignature(false);
        if (result.success) {
            toast.success("서명 설정이 저장되었습니다.");
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    const updateSig = (field: keyof SignatureData, value: string) => {
        setSig((prev) => ({ ...prev, [field]: value }));
    };

    const addWebsite = () => {
        setSig((prev) => ({ ...prev, websites: [...(prev.websites || []), ""] }));
    };

    const updateWebsite = (index: number, value: string) => {
        setSig((prev) => {
            const websites = [...(prev.websites || [])];
            websites[index] = value;
            return { ...prev, websites };
        });
    };

    const removeWebsite = (index: number) => {
        setSig((prev) => {
            const websites = [...(prev.websites || [])];
            websites.splice(index, 1);
            return { ...prev, websites };
        });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>NHN Cloud Email 설정</CardTitle>
                    <CardDescription>
                        NHN Cloud Email 서비스의 API 키와 발신 정보를 입력해주세요.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="email-appKey">App Key</Label>
                        <Input
                            id="email-appKey"
                            value={appKey}
                            onChange={(e) => {
                                setAppKey(e.target.value);
                                setTestStatus("idle");
                            }}
                            placeholder="NHN Cloud Email App Key"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email-secretKey">Secret Key</Label>
                        <Input
                            id="email-secretKey"
                            type="password"
                            value={secretKey}
                            onChange={(e) => {
                                setSecretKey(e.target.value);
                                setTestStatus("idle");
                            }}
                            placeholder={config ? "변경하려면 새 Secret Key 입력" : "NHN Cloud Secret Key"}
                        />
                        {config && !secretKey && (
                            <p className="text-xs text-muted-foreground">
                                현재 설정됨: {config.secretKey}
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email-fromName">발신 이름</Label>
                        <Input
                            id="email-fromName"
                            value={fromName}
                            onChange={(e) => setFromName(e.target.value)}
                            placeholder="SalesFlow"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email-fromEmail">발신 이메일</Label>
                        <Input
                            id="email-fromEmail"
                            type="email"
                            value={fromEmail}
                            onChange={(e) => setFromEmail(e.target.value)}
                            placeholder="noreply@example.com"
                        />
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <Button
                            variant="outline"
                            onClick={handleTest}
                            disabled={testStatus === "testing" || !appKey || !secretKey}
                        >
                            {testStatus === "testing" && (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            )}
                            {testStatus === "success" && (
                                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                            )}
                            {testStatus === "fail" && (
                                <XCircle className="h-4 w-4 mr-2 text-red-500" />
                            )}
                            연결 테스트
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !appKey || !secretKey}
                        >
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>이메일 서명</CardTitle>
                            <CardDescription>
                                이메일 하단에 자동으로 추가되는 서명을 설정합니다.
                            </CardDescription>
                        </div>
                        <Switch
                            checked={signatureEnabled}
                            onCheckedChange={setSignatureEnabled}
                        />
                    </div>
                </CardHeader>
                {signatureEnabled && (
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="sig-name">이름</Label>
                                <Input
                                    id="sig-name"
                                    value={sig.name || ""}
                                    onChange={(e) => updateSig("name", e.target.value)}
                                    placeholder="홍길동"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="sig-title">직책</Label>
                                <Input
                                    id="sig-title"
                                    value={sig.title || ""}
                                    onChange={(e) => updateSig("title", e.target.value)}
                                    placeholder="영업팀 매니저"
                                />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="sig-company">회사</Label>
                                <Input
                                    id="sig-company"
                                    value={sig.company || ""}
                                    onChange={(e) => updateSig("company", e.target.value)}
                                    placeholder="SalesFlow Inc."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="sig-phone">전화번호</Label>
                                <Input
                                    id="sig-phone"
                                    value={sig.phone || ""}
                                    onChange={(e) => updateSig("phone", e.target.value)}
                                    placeholder="010-1234-5678"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="sig-email">이메일 주소</Label>
                            <Input
                                id="sig-email"
                                type="email"
                                value={sig.email || ""}
                                onChange={(e) => updateSig("email", e.target.value)}
                                placeholder="hong@company.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>웹사이트</Label>
                                <Button type="button" variant="ghost" size="sm" onClick={addWebsite}>
                                    <Plus className="h-4 w-4 mr-1" />
                                    추가
                                </Button>
                            </div>
                            {(sig.websites || []).map((url, i) => (
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
                            <Label htmlFor="sig-extra">기타 정보</Label>
                            <Input
                                id="sig-extra"
                                value={sig.extra || ""}
                                onChange={(e) => updateSig("extra", e.target.value)}
                                placeholder="서울시 강남구 테헤란로 123"
                            />
                        </div>
                        <Button
                            onClick={handleSaveSignature}
                            disabled={savingSignature || !config}
                        >
                            {savingSignature && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            서명 저장
                        </Button>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
