"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, HelpCircle, Loader2 } from "lucide-react";
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

const TRIGGER_LABELS: Record<string, string> = {
    on_create: "생성 시",
    on_update: "수정 시",
};

const OPERATOR_LABELS: Record<string, string> = {
    eq: "같음",
    ne: "같지 않음",
    contains: "포함",
};

function HelpTip({ text }: { text: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground inline ml-1 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-60">
                <p className="text-xs">{text}</p>
            </TooltipContent>
        </Tooltip>
    );
}

function EditAiAutoPageContent() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const linkId = Number(params.id);
    const partitionId = Number(searchParams.get("partitionId"));

    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);
    const workspaceId = (allPartitionsData?.data as Array<{ id: number; workspaceId: number }>)
        ?.find((p) => p.id === partitionId)?.workspaceId ?? null;

    const { links, isLoading, updateLink } = useAutoPersonalizedEmail(partitionId || null);
    const { products } = useProducts({ activeOnly: true });
    const { fields } = useFields(workspaceId);
    const link = links.find((l) => l.id === linkId);

    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
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

    const selectedProduct = products.find((p) => p.id === productId);

    useEffect(() => {
        if (link && !loaded) {
            setProductId(link.productId);
            setTriggerType(link.triggerType as "on_create" | "on_update");
            setRecipientField(link.recipientField);
            setCompanyField(link.companyField);
            setPrompt(link.prompt || "");
            setTone(link.tone || "");
            setFormat((link.format as "plain" | "designed") || "plain");
            setAutoResearch(link.autoResearch === 1);
            setUseSignaturePersona(link.useSignaturePersona === 1);
            setFollowupConfig(link.followupConfig ?? null);
            if (link.triggerCondition?.field) {
                setConditionEnabled(true);
                setConditionField(link.triggerCondition.field);
                setConditionOperator(link.triggerCondition.operator || "eq");
                setConditionValue(link.triggerCondition.value || "");
            }
            setLoaded(true);
        }
    }, [link, loaded]);

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

            const result = await updateLink(linkId, {
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
                toast.success("규칙이 수정되었습니다.");
                router.push("/email?tab=ai-auto");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    if (isLoading) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </WorkspaceLayout>
        );
    }

    if (!link) {
        return (
            <WorkspaceLayout>
                <div className="flex items-center justify-center h-64 text-muted-foreground">
                    규칙을 찾을 수 없습니다.
                </div>
            </WorkspaceLayout>
        );
    }

    return (
        <WorkspaceLayout>
            <TooltipProvider>
                <PageContainer>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" size="icon" onClick={() => router.push("/email?tab=ai-auto")}>
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            <h1 className="text-xl font-semibold">AI 개인화 발송 규칙 수정</h1>
                        </div>
                        <Button onClick={handleSave} disabled={saving || !recipientField || !companyField}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            수정
                        </Button>
                    </div>

                    <div className="flex gap-6">
                        {/* Left: Form */}
                        <div className="flex-1 min-w-0 space-y-6">
                            {/* Card 1: 기본 정보 */}
                            <Card id="section-basic">
                                <CardHeader>
                                    <CardTitle>기본 정보</CardTitle>
                                    <CardDescription>제품, 트리거, 수신자 설정</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>
                                            제품
                                            <HelpTip text="이메일에 포함할 제품 정보를 선택하세요. 선택 안하면 일반 이메일로 발송됩니다." />
                                        </Label>
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
                                        <Label>
                                            트리거
                                            <HelpTip text="레코드가 생성되거나 수정될 때 자동으로 이메일을 발송합니다" />
                                        </Label>
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
                                        <Label>
                                            수신자 이메일 필드
                                            <HelpTip text="이메일 주소가 저장된 레코드 필드를 선택하세요" />
                                        </Label>
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
                                        <Label>
                                            회사명 필드
                                            <HelpTip text="회사명이 저장된 필드입니다. AI가 회사 조사에 활용합니다." />
                                        </Label>
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
                                </CardContent>
                            </Card>

                            {/* Card 2: AI 설정 */}
                            <Card id="section-ai">
                                <CardHeader>
                                    <CardTitle>AI 설정</CardTitle>
                                    <CardDescription>AI 이메일 생성 방식과 톤 설정</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>
                                            AI 지시사항
                                            <HelpTip text="직접 입력하면 형식/톤 설정 대신 이 내용이 사용됩니다" />
                                        </Label>
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
                                </CardContent>
                            </Card>

                            {/* Card 3: 발송 조건 */}
                            <Card id="section-condition">
                                <CardHeader>
                                    <CardTitle>발송 조건</CardTitle>
                                    <CardDescription>특정 조건을 만족할 때만 이메일 발송</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <Label>조건 사용</Label>
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
                                </CardContent>
                            </Card>

                            {/* Card 4: 후속 발송 */}
                            <Card id="section-followup">
                                <CardHeader>
                                    <CardTitle>후속 발송</CardTitle>
                                    <CardDescription>일정 기간 후 자동으로 후속 이메일 발송</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <FollowupConfigForm
                                        mode="ai"
                                        value={followupConfig}
                                        onChange={setFollowupConfig}
                                    />
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right: Summary Panel */}
                        <div className="hidden lg:block w-[320px] shrink-0">
                            <div className="sticky top-6 space-y-4">
                                {/* Section Anchors */}
                                <div className="flex flex-wrap gap-2 text-sm">
                                    <button onClick={() => document.getElementById("section-basic")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">기본 정보</button>
                                    <span className="text-muted-foreground">/</span>
                                    <button onClick={() => document.getElementById("section-ai")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">AI 설정</button>
                                    <span className="text-muted-foreground">/</span>
                                    <button onClick={() => document.getElementById("section-condition")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">발송 조건</button>
                                    <span className="text-muted-foreground">/</span>
                                    <button onClick={() => document.getElementById("section-followup")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">후속 발송</button>
                                </div>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm">요약</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">제품</span>
                                            <span className="font-medium truncate ml-2 max-w-40">{selectedProduct?.name || "미지정"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">트리거</span>
                                            <Badge>{TRIGGER_LABELS[triggerType]}</Badge>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">수신 필드</span>
                                            <span className="font-medium">{recipientField || "—"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">회사 필드</span>
                                            <span className="font-medium">{companyField || "—"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">형식</span>
                                            <Badge variant="outline">
                                                {prompt.trim() ? "커스텀" : FORMAT_OPTIONS.find((f) => f.value === format)?.label}
                                            </Badge>
                                        </div>
                                        {!prompt.trim() && (
                                            <div className="flex justify-between items-center">
                                                <span className="text-muted-foreground">톤</span>
                                                <Badge variant="outline">
                                                    {TONE_OPTIONS.find((t) => t.value === tone)?.label || "기본"}
                                                </Badge>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">자동 조사</span>
                                            <Badge variant={autoResearch ? "default" : "outline"}>
                                                {autoResearch ? "ON" : "OFF"}
                                            </Badge>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">페르소나</span>
                                            <Badge variant={useSignaturePersona ? "default" : "outline"}>
                                                {useSignaturePersona ? "ON" : "OFF"}
                                            </Badge>
                                        </div>
                                        {conditionEnabled && conditionField && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">조건</span>
                                                <span className="font-medium text-xs">
                                                    {conditionField} {OPERATOR_LABELS[conditionOperator]} {conditionValue}
                                                </span>
                                            </div>
                                        )}
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">후속 발송</span>
                                            {followupConfig ? (
                                                <Badge>{followupConfig.delayDays}일 후</Badge>
                                            ) : (
                                                <Badge variant="outline">OFF</Badge>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </div>
                </PageContainer>
            </TooltipProvider>
        </WorkspaceLayout>
    );
}

export default function EditAiAutoPage() {
    return (
        <Suspense>
            <EditAiAutoPageContent />
        </Suspense>
    );
}
