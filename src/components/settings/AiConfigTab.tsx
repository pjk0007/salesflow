import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAiConfig } from "@/hooks/useAiConfig";
import { useSession } from "@/contexts/SessionContext";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

const PROVIDER_OPTIONS = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
];

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
    openai: [
        { value: "gpt-4.1", label: "GPT-4.1" },
        { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
        { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
        { value: "gpt-4o", label: "GPT-4o" },
    ],
    anthropic: [
        { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
        { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
        { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
};

export default function AiConfigTab() {
    const { user } = useSession();
    const { config, isLoading, saveConfig, testConnection } = useAiConfig();
    const canEdit = user?.role === "owner" || user?.role === "admin";

    const [provider, setProvider] = useState("openai");
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isTesting, setIsTesting] = useState(false);

    useEffect(() => {
        if (config) {
            setProvider(config.provider);
            setApiKey(config.apiKey); // masked value
            setModel(config.model ?? "");
            setIsEditing(false);
        } else if (!isLoading) {
            setIsEditing(true);
        }
    }, [config, isLoading]);

    const handleProviderChange = (value: string) => {
        setProvider(value);
        const models = MODEL_OPTIONS[value];
        if (models?.length) {
            setModel(models[0].value);
        }
    };

    const handleTest = async () => {
        if (!apiKey || apiKey.includes("***")) {
            toast.error("API 키를 입력해주세요.");
            return;
        }

        setIsTesting(true);
        try {
            const result = await testConnection({ provider, apiKey });
            if (result.success && result.data?.connected) {
                toast.success("연결 성공! API 키가 유효합니다.", {
                    icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
                });
            } else {
                toast.error(result.data?.error || "연결에 실패했습니다.", {
                    icon: <XCircle className="h-4 w-4 text-red-500" />,
                });
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsTesting(false);
        }
    };

    const handleSave = async () => {
        if (!apiKey || apiKey.includes("***")) {
            toast.error("API 키를 입력해주세요.");
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await saveConfig({
                provider,
                apiKey,
                model: model || undefined,
            });
            if (result.success) {
                toast.success("AI 설정이 저장되었습니다.");
                setIsEditing(false);
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } catch {
            toast.error("서버에 연결할 수 없습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return <div className="text-muted-foreground py-8 text-center">로딩 중...</div>;
    }

    const models = MODEL_OPTIONS[provider] ?? [];
    const hasExistingConfig = !!config;
    const apiKeyPlaceholder = provider === "openai" ? "sk-..." : "sk-ant-api03-...";

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>AI 설정</CardTitle>
                    <CardDescription>AI 모델 연동을 위한 API 키를 설정합니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 max-w-lg">
                    {!canEdit && (
                        <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
                            AI 설정은 관리자 이상만 수정할 수 있습니다.
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label>AI 제공자</Label>
                        <Select
                            value={provider}
                            onValueChange={handleProviderChange}
                            disabled={!canEdit || (!isEditing && hasExistingConfig)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PROVIDER_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label>
                            API 키 <span className="text-destructive">*</span>
                        </Label>
                        {hasExistingConfig && !isEditing ? (
                            <div className="flex gap-2">
                                <Input
                                    value={config.apiKey}
                                    disabled
                                    className="flex-1 font-mono"
                                />
                                {canEdit && (
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            setIsEditing(true);
                                            setApiKey("");
                                        }}
                                    >
                                        변경
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <Input
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                disabled={!canEdit}
                                placeholder={apiKeyPlaceholder}
                                className="font-mono"
                            />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label>기본 모델</Label>
                        <Select
                            value={model}
                            onValueChange={setModel}
                            disabled={!canEdit || (!isEditing && hasExistingConfig)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="모델 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {models.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {canEdit && isEditing && (
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={handleTest}
                                disabled={isTesting || !apiKey || apiKey.includes("***")}
                            >
                                {isTesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                연결 테스트
                            </Button>
                            <Button onClick={handleSave} disabled={isSubmitting}>
                                {isSubmitting ? "저장 중..." : "저장"}
                            </Button>
                            {hasExistingConfig && (
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        setIsEditing(false);
                                        setApiKey(config.apiKey);
                                        setProvider(config.provider);
                                        setModel(config.model ?? "");
                                    }}
                                >
                                    취소
                                </Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
