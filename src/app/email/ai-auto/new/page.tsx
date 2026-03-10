"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAutoPersonalizedEmail } from "@/hooks/useAutoPersonalizedEmail";
import { useProducts } from "@/hooks/useProducts";
import { useFields } from "@/hooks/useFields";
import { FollowupConfigForm } from "@/components/email/FollowupConfigForm";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const FORMAT_OPTIONS = [
    { value: "plain", label: "간결한 텍스트" },
    { value: "designed", label: "디자인 이메일" },
];

const TONE_OPTIONS = [
    { value: "", label: "기본" },
    { value: "concise", label: "간결한 (AI 티 안 나게)" },
    { value: "professional", label: "전문적" },
    { value: "friendly", label: "친근한" },
    { value: "formal", label: "격식있는" },
];

function NewAiAutoPageContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const partitionId = Number(searchParams.get("partitionId"));

    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);
    const workspaceId = (allPartitionsData?.data as Array<{ id: number; workspaceId: number }>)
        ?.find((p) => p.id === partitionId)?.workspaceId ?? null;

    const { createLink } = useAutoPersonalizedEmail(partitionId || null);
    const { products } = useProducts({ activeOnly: true });
    const { fields } = useFields(workspaceId);

    const [saving, setSaving] = useState(false);
    const [productId, setProductId] = useState<number | null>(null);
    const [triggerType, setTriggerType] = useState<"on_create" | "on_update">("on_create");
    const [recipientField, setRecipientField] = useState("");
    const [companyField, setCompanyField] = useState("");
    const [prompt, setPrompt] = useState("");
    const [tone, setTone] = useState("");
    const [format, setFormat] = useState<"plain" | "designed">("plain");
    const [autoResearch, setAutoResearch] = useState(true);
    const [useSignaturePersona, setUseSignaturePersona] = useState(false);
    const [conditionEnabled, setConditionEnabled] = useState(false);
    const [conditionField, setConditionField] = useState("");
    const [conditionOperator, setConditionOperator] = useState("eq");
    const [conditionValue, setConditionValue] = useState("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [followupConfig, setFollowupConfig] = useState<any>(null);

    const handleSave = async () => {
        if (!recipientField || !companyField) {
            toast.error("필수 항목을 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            const triggerCondition = conditionEnabled && conditionField
                ? { field: conditionField, operator: conditionOperator, value: conditionValue }
                : null;

            const result = await createLink({
                partitionId,
                productId,
                triggerType,
                recipientField,
                companyField,
                prompt: prompt || undefined,
                tone: tone || undefined,
                format,
                autoResearch: autoResearch ? 1 : 0,
                useSignaturePersona: useSignaturePersona ? 1 : 0,
                triggerCondition,
                followupConfig: followupConfig || null,
            });
            if (result.success) {
                toast.success("규칙이 생성되었습니다.");
                router.push("/email?tab=ai-auto");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    if (!partitionId) {
        return (
            <WorkspaceLayout>
                <PageContainer>
                    <div className="text-center text-muted-foreground py-12">
                        파티션 정보가 없습니다.
                    </div>
                </PageContainer>
            </WorkspaceLayout>
        );
    }

    return (
        <WorkspaceLayout>
            <PageContainer>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => router.push("/email?tab=ai-auto")}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <h1 className="text-xl font-semibold">AI 개인화 발송 규칙 추가</h1>
                    </div>
                    <Button onClick={handleSave} disabled={saving || !recipientField || !companyField}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        저장
                    </Button>
                </div>

                <div className="max-w-2xl space-y-6">
                    <div className="space-y-2">
                        <Label>제품</Label>
                        <Select
                            value={productId?.toString() ?? "none"}
                            onValueChange={(v) => setProductId(v === "none" ? null : Number(v))}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="제품 선택 (선택사항)" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">선택 안함</SelectItem>
                                {products.map((p) => (
                                    <SelectItem key={p.id} value={p.id.toString()}>
                                        {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>트리거</Label>
                        <Select
                            value={triggerType}
                            onValueChange={(v) => setTriggerType(v as "on_create" | "on_update")}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="on_create">레코드 생성 시</SelectItem>
                                <SelectItem value="on_update">레코드 수정 시</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>수신자 이메일 필드</Label>
                        <Select value={recipientField} onValueChange={setRecipientField}>
                            <SelectTrigger>
                                <SelectValue placeholder="필드 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {fields.map((f) => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>회사명 필드</Label>
                        <Select value={companyField} onValueChange={setCompanyField}>
                            <SelectTrigger>
                                <SelectValue placeholder="필드 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {fields.map((f) => (
                                    <SelectItem key={f.key} value={f.key}>
                                        {f.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>AI 지시사항</Label>
                        <Textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="직접 지시사항을 입력하면 아래 형식/톤 설정 대신 이 내용이 사용됩니다."
                            rows={3}
                        />
                        {prompt.trim() && (
                            <p className="text-xs text-muted-foreground">직접 지시사항이 입력되어 형식/톤 설정은 무시됩니다.</p>
                        )}
                    </div>

                    {!prompt.trim() && (
                        <>
                            <div className="space-y-2">
                                <Label>이메일 형식</Label>
                                <Select value={format} onValueChange={(v) => setFormat(v as "plain" | "designed")}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FORMAT_OPTIONS.map((f) => (
                                            <SelectItem key={f.value} value={f.value}>
                                                {f.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {format === "plain" ? "편지처럼 간결한 텍스트 이메일" : "헤더, CTA 버튼 등 디자인 포함 이메일"}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>톤</Label>
                                <Select value={tone} onValueChange={setTone}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="기본" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {TONE_OPTIONS.map((t) => (
                                            <SelectItem key={t.value || "default"} value={t.value || "default"}>
                                                {t.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </>
                    )}

                    <div className="border-t pt-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>발송 조건</Label>
                                <p className="text-xs text-muted-foreground">특정 조건을 만족할 때만 발송</p>
                            </div>
                            <Switch checked={conditionEnabled} onCheckedChange={setConditionEnabled} />
                        </div>

                        {conditionEnabled && (
                            <div className="grid grid-cols-3 gap-2">
                                <Select value={conditionField} onValueChange={setConditionField}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="필드" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {fields.map((f) => (
                                            <SelectItem key={f.key} value={f.key}>
                                                {f.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={conditionOperator} onValueChange={setConditionOperator}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="eq">같음</SelectItem>
                                        <SelectItem value="ne">같지 않음</SelectItem>
                                        <SelectItem value="contains">포함</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Input
                                    value={conditionValue}
                                    onChange={(e) => setConditionValue(e.target.value)}
                                    placeholder="값"
                                />
                            </div>
                        )}

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>서명 발신자 페르소나</Label>
                                <p className="text-xs text-muted-foreground">이메일 서명의 이름/직함으로 발신자 톤을 설정</p>
                            </div>
                            <Switch checked={useSignaturePersona} onCheckedChange={setUseSignaturePersona} />
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>회사 자동 조사</Label>
                                <p className="text-xs text-muted-foreground">AI 웹 검색으로 회사 정보를 자동 조사</p>
                            </div>
                            <Switch checked={autoResearch} onCheckedChange={setAutoResearch} />
                        </div>
                    </div>

                    <div className="border-t pt-6">
                        <FollowupConfigForm
                            mode="ai"
                            value={followupConfig}
                            onChange={setFollowupConfig}
                        />
                    </div>
                </div>
            </PageContainer>
        </WorkspaceLayout>
    );
}

export default function NewAiAutoPage() {
    return (
        <Suspense>
            <NewAiAutoPageContent />
        </Suspense>
    );
}
