import { useState, useEffect } from "react";
import { useEmailConfig } from "@/hooks/useEmailConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function EmailConfigForm() {
    const { config, isLoading, saveConfig, testConnection } = useEmailConfig();
    const [appKey, setAppKey] = useState("");
    const [secretKey, setSecretKey] = useState("");
    const [fromName, setFromName] = useState("");
    const [fromEmail, setFromEmail] = useState("");
    const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (config) {
            setAppKey(config.appKey);
            setFromName(config.fromName || "");
            setFromEmail(config.fromEmail || "");
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

    const handleSave = async () => {
        if (!appKey || !secretKey) {
            toast.error("appKey와 secretKey를 입력해주세요.");
            return;
        }
        setSaving(true);
        const result = await saveConfig({ appKey, secretKey, fromName, fromEmail });
        setSaving(false);
        if (result.success) {
            toast.success("이메일 설정이 저장되었습니다.");
        } else {
            toast.error(result.error || "저장에 실패했습니다.");
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
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
    );
}
