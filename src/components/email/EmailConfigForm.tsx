"use client";

import { useState, useEffect } from "react";
import { useEmailConfig } from "@/hooks/useEmailConfig";
import { useSenderProfiles } from "@/hooks/useSenderProfiles";
import { useSignatures } from "@/hooks/useSignatures";
import SenderProfileManager from "./SenderProfileManager";
import SignatureManager from "./SignatureManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function EmailConfigForm() {
    const { config, isLoading: configLoading, saveConfig, testConnection } = useEmailConfig();
    const { profiles, createProfile, updateProfile, deleteProfile, isLoading: profilesLoading } = useSenderProfiles();
    const { signatures, createSignature, updateSignature, deleteSignature, isLoading: signaturesLoading } = useSignatures();

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
            <SenderProfileManager
                profiles={profiles}
                createProfile={createProfile}
                updateProfile={updateProfile}
                deleteProfile={deleteProfile}
            />

            {/* 서명 관리 */}
            <SignatureManager
                signatures={signatures}
                createSignature={createSignature}
                updateSignature={updateSignature}
                deleteSignature={deleteSignature}
            />
        </div>
    );
}
