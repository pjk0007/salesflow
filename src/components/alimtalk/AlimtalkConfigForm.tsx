import { useState, useEffect } from "react";
import { useAlimtalkConfig } from "@/hooks/useAlimtalkConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function AlimtalkConfigForm() {
    const { config, isLoading, saveConfig, testConnection } = useAlimtalkConfig();
    const [appKey, setAppKey] = useState("");
    const [secretKey, setSecretKey] = useState("");
    const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "fail">("idle");
    const [saving, setSaving] = useState(false);

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
        if (result.success) {
            setTestStatus("success");
            toast.success(`연결 성공! 발신프로필 ${result.data.senderCount}개 확인`);
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
        const result = await saveConfig({ appKey, secretKey });
        setSaving(false);
        if (result.success) {
            toast.success("알림톡 설정이 저장되었습니다.");
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
                <CardTitle>NHN Cloud API 설정</CardTitle>
                <CardDescription>
                    NHN Cloud KakaoTalk Bizmessage 서비스의 API 키를 입력해주세요.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="appKey">App Key</Label>
                    <Input
                        id="appKey"
                        value={appKey}
                        onChange={(e) => {
                            setAppKey(e.target.value);
                            setTestStatus("idle");
                        }}
                        placeholder="NHN Cloud App Key"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="secretKey">Secret Key</Label>
                    <Input
                        id="secretKey"
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

                {config?.defaultSenderKey && (
                    <div className="space-y-2">
                        <Label>기본 발신프로필</Label>
                        <p className="text-sm text-muted-foreground">
                            {config.defaultSenderKey}
                        </p>
                    </div>
                )}

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
