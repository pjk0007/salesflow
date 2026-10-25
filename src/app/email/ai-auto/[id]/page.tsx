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
import { PromptWithVariableInsert } from "@/components/email/PromptWithVariableInsert";
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
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AsyncAlertDialog,
    useAsyncConfirm,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, HelpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAutoPersonalizedEmail, type ImpactedExperiment } from "@/hooks/useAutoPersonalizedEmail";
import { useProducts } from "@/hooks/useProducts";
import { useResolvedFields } from "@/hooks/useResolvedFields";
import { FollowupConfigForm } from "@/components/email/FollowupConfigForm";
import AssetPickerField from "@/components/email/assets/ui/AssetPickerField";
import SenderPoolField from "@/components/email/sender-profiles/ui/SenderPoolField";
import SenderPoolSummary from "@/components/email/sender-profiles/ui/SenderPoolSummary";
import RuleQueueSummary from "@/components/email/sender-profiles/ui/RuleQueueSummary";
import ReplyToSummaryRow from "@/components/email/reply-to/ui/ReplyToSummaryRow";
import { AI_MODELS, DEFAULT_MODEL_ID } from "@/lib/ai/models";
import { linkSenderPool } from "@/lib/email-sender-limit-rules";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

interface EmailSignature { id: number; name: string; isDefault: boolean; }

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

const EXPERIMENT_STATE_LABELS: Record<string, string> = {
    running: "모집 중",
    paused: "일시 중지",
    enrollment_closed: "모집 종료",
    observing: "관찰 중",
    decision_ready: "판단 가능",
    data_check: "자료 확인 필요",
    insufficient_sample: "표본 부족",
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
    const initialPartitionId = Number(searchParams.get("partitionId"));
    const [currentPartitionId, setCurrentPartitionId] = useState<number>(initialPartitionId);

    const { data: allPartitionsData } = useSWR("/api/partitions", defaultFetcher);
    // 초기 로드는 URL의 partitionId로 (link 조회용), 이후 화면 표시는 currentPartitionId 기반
    const { links, isLoading, updateLink } = useAutoPersonalizedEmail(initialPartitionId || null);
    const { products } = useProducts({ activeOnly: true });
    const { fields } = useResolvedFields(currentPartitionId || null);
    const { data: signaturesData } = useSWR("/api/email/signatures", defaultFetcher);
    const signatures: EmailSignature[] = signaturesData?.data ?? [];
    const link = links.find((l) => l.id === linkId);
    // 대기·예상 소진일은 저장된 묶음으로 센 값이다 — 폼에서 묶음을 바꿨는지 요약 칸이 알리게 넘긴다
    const savedSenderIds = link
        ? linkSenderPool({ senderProfileId: link.senderProfileId ?? null, senderProfileIds: link.senderProfileIds ?? null })
        : undefined;

    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [name, setName] = useState("");
    const [productId, setProductId] = useState<number | null>(null);
    const [ctaUrl, setCtaUrl] = useState("");
    const [triggerType, setTriggerType] = useState<"on_create" | "on_update">("on_create");
    const [recipientField, setRecipientField] = useState("");
    const [companyField, setCompanyField] = useState("");
    const [prompt, setPrompt] = useState("");
    const [tone, setTone] = useState("");
    const [model, setModel] = useState(DEFAULT_MODEL_ID);
    const [format, setFormat] = useState<"plain" | "designed">("plain");
    const [autoResearch, setAutoResearch] = useState(true);
    const [useSignaturePersona, setUseSignaturePersona] = useState(false);
    const [useUnsubscribe, setUseUnsubscribe] = useState(false);
    const [conditionEnabled, setConditionEnabled] = useState(false);
    const [conditionField, setConditionField] = useState("");
    const [conditionOperator, setConditionOperator] = useState("eq");
    const [conditionValue, setConditionValue] = useState("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [followupConfig, setFollowupConfig] = useState<any>(null);
    const [preventDuplicate, setPreventDuplicate] = useState(0);
    // 발신 주소 묶음 (순서 있음). 비어 있으면 기본 발신 프로필로 보낸다
    const [senderProfileIds, setSenderProfileIds] = useState<number[]>([]);
    const [signatureId, setSignatureId] = useState<number | null>(null);
    const [assetIds, setAssetIds] = useState<number[]>([]);

    // DB(파티션) 변경 confirm dialog
    const [pendingPartitionId, setPendingPartitionId] = useState<number | null>(null);
    const {
        fields: pendingFields,
        isLoading: pendingFieldsLoading,
        loadError: pendingFieldsError,
        mutate: reloadPendingFields,
    } = useResolvedFields(pendingPartitionId);
    // 새 DB 필드를 실제로 받은 뒤에만 호환 여부를 판단한다 — 미조회와 '필드 0개'를 구별한다
    const pendingFieldsReady = pendingPartitionId !== null && !pendingFieldsLoading && !pendingFieldsError;

    // 저장이 진행 중 문구 실험을 무효화하게 되면 확인을 받는다 (서버 409 experiment_impact)
    const [experimentImpact, setExperimentImpact] = useState<{ asDraft: boolean; experiments: ImpactedExperiment[] } | null>(null);
    const { confirm, confirmationDialog } = useAsyncConfirm();

    const selectedProduct = products.find((p) => p.id === productId);

    // pending DB로 바꾸면 비워질 필드 키 목록
    const fieldsToReset = (() => {
        if (!pendingFieldsReady) return [];
        const keySet = new Set(pendingFields.map((f) => f.key));
        const candidates: { key: string; label: string }[] = [];
        const lookupLabel = (key: string) =>
            fields.find((f) => f.key === key)?.label ?? key;
        if (recipientField && !keySet.has(recipientField)) {
            candidates.push({ key: "수신자 이메일", label: lookupLabel(recipientField) });
        }
        if (companyField && !keySet.has(companyField)) {
            candidates.push({ key: "회사명", label: lookupLabel(companyField) });
        }
        if (conditionEnabled && conditionField && !keySet.has(conditionField)) {
            candidates.push({ key: "트리거 조건", label: lookupLabel(conditionField) });
        }
        return candidates;
    })();

    const partitionItems = (allPartitionsData?.data as Array<{ id: number; name: string; workspaceId: number; workspaceName: string }>) ?? [];
    const hasMultiWs = new Set(partitionItems.map((p) => p.workspaceId)).size > 1;

    const handlePartitionSelectChange = (newId: number) => {
        if (newId === currentPartitionId) return;
        setPendingPartitionId(newId);
    };

    const confirmPartitionChange = () => {
        if (!pendingPartitionId || !pendingFieldsReady) return;
        const keySet = new Set(pendingFields.map((f) => f.key));
        // 비호환 필드 초기화
        if (recipientField && !keySet.has(recipientField)) setRecipientField("");
        if (companyField && !keySet.has(companyField)) setCompanyField("");
        if (conditionEnabled && conditionField && !keySet.has(conditionField)) {
            setConditionField("");
            setConditionValue("");
        }
        setCurrentPartitionId(pendingPartitionId);
        if (fieldsToReset.length > 0) {
            toast.warning(
                `다음 항목이 초기화되었습니다: ${fieldsToReset.map((f) => f.key).join(", ")}`,
            );
        } else {
            toast.success("DB가 변경되었습니다.");
        }
        setPendingPartitionId(null);
    };

    const cancelPartitionChange = () => setPendingPartitionId(null);

    useEffect(() => {
        if (link && !loaded) {
            setName((link as unknown as { name?: string }).name || "");
            setProductId(link.productId);
            setCtaUrl(link.ctaUrl || "");
            setTriggerType(link.triggerType as "on_create" | "on_update");
            setRecipientField(link.recipientField);
            setCompanyField(link.companyField);
            setPrompt(link.prompt || "");
            setTone(link.tone || "");
            setModel(link.model || DEFAULT_MODEL_ID);
            setFormat((link.format as "plain" | "designed") || "plain");
            setAutoResearch(link.autoResearch === 1);
            setUseSignaturePersona(link.useSignaturePersona === 1);
            setUseUnsubscribe(link.useUnsubscribe === 1);
            setFollowupConfig(link.followupConfig ?? null);
            setPreventDuplicate(link.preventDuplicate ?? 0);
            // 묶음 칸이 생기기 전 규칙은 senderProfileId 하나만 있다 — 그 하나를 묶음으로 읽는다
            setSenderProfileIds(linkSenderPool({
                senderProfileId: link.senderProfileId ?? null,
                senderProfileIds: link.senderProfileIds ?? null,
            }));
            setSignatureId(link.signatureId ?? null);
            setAssetIds(link.assetIds ?? []);
            if (link.triggerCondition?.field) {
                setConditionEnabled(true);
                setConditionField(link.triggerCondition.field);
                setConditionOperator(link.triggerCondition.operator || "eq");
                setConditionValue(link.triggerCondition.value || "");
            }
            setLoaded(true);
        }
    }, [link, loaded]);

    const isDraftRule = (link as unknown as { isDraft?: number })?.isDraft === 1;

    /**
     * 저장 요청 하나. 실패는 한국어 Error로 던진다(버튼은 토스트, 확인창은 창 안에 표시).
     * 진행 중 문구 실험이 무효화되는 변경이면 저장하지 않고 해당 실험 목록을 돌려준다.
     */
    const submit = async (asDraft: boolean, confirmExperimentImpact = false): Promise<ImpactedExperiment[] | null> => {
        const triggerCondition = conditionEnabled && conditionField
            ? { field: conditionField, operator: conditionOperator, value: conditionValue }
            : null;
        let result;
        try {
            result = await updateLink(linkId, {
                // 수정에서 빈 문자열은 '지움'이다 — 서버가 null로 저장한다 (생성의 '생략'과 구분)
                name,
                partitionId: currentPartitionId,
                productId,
                ctaUrl: ctaUrl.trim(),
                triggerType,
                recipientField,
                companyField,
                prompt,
                tone,
                // 모델을 고르지 않은 규칙은 그대로 둔다(기본 모델로 생성) — 저장만으로 실험 비교 조건이 바뀌지 않게
                model: !link?.model && model === DEFAULT_MODEL_ID ? null : model,
                format,
                autoResearch: autoResearch ? 1 : 0,
                useSignaturePersona: useSignaturePersona ? 1 : 0,
                useUnsubscribe: useUnsubscribe ? 1 : 0,
                triggerCondition,
                followupConfig: followupConfig || null,
                preventDuplicate,
                senderProfileIds,
                signatureId,
                assetIds,
                isDraft: asDraft ? 1 : 0,
                ...(confirmExperimentImpact && { confirmExperimentImpact: true }),
            });
        } catch {
            throw new Error("저장 결과를 확인하지 못했습니다. 목록에서 반영 여부를 확인한 뒤 다시 시도해주세요.");
        }
        if (result?.code === "experiment_impact" && Array.isArray(result.experiments)) {
            return result.experiments as ImpactedExperiment[];
        }
        if (!result?.success) throw new Error(result?.error || "저장에 실패했습니다.");
        toast.success(asDraft ? "임시저장되었습니다." : "규칙이 수정되었습니다.");
        router.push("/email?tab=ai-auto");
        return null;
    };

    const saveOrAskImpact = async (asDraft: boolean) => {
        const experiments = await submit(asDraft);
        if (experiments) setExperimentImpact({ asDraft, experiments });
    };

    const handleSave = async (asDraft = false) => {
        if (!asDraft && (!recipientField || !companyField)) {
            toast.error("필수 항목을 입력해주세요.");
            return;
        }
        // 초안을 정식으로 저장하면 자동 발송이 켜진다 — 상태가 바뀌는 저장만 확인을 받는다 (UX-139)
        if (!asDraft && isDraftRule) {
            confirm({
                title: "정식 저장하고 자동 발송을 켤까요?",
                description: `정식 저장하면 이 규칙이 활성화되어 이후 레코드 ${triggerType === "on_update" ? "수정" : "생성"} 시 조건에 맞으면 AI 메일이 자동 발송됩니다.`,
                confirmLabel: "정식 저장",
                pendingLabel: "저장 중...",
                onConfirm: () => saveOrAskImpact(false),
            });
            return;
        }
        setSaving(true);
        try {
            await saveOrAskImpact(asDraft);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "저장에 실패했습니다.");
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
                    {/* 좁은 화면에서는 제목·DB 선택·저장 버튼을 줄바꿈해 저장 버튼이 화면 안에 들어오게 한다 */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-3">
                            <Button variant="ghost" size="icon" onClick={() => router.push("/email?tab=ai-auto")}>
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            <h1 className="text-xl font-semibold">AI 개인화 발송 규칙 수정</h1>
                            <Select
                                value={String(currentPartitionId)}
                                onValueChange={(v) => handlePartitionSelectChange(Number(v))}
                            >
                                <SelectTrigger className="w-65 max-w-full h-8 text-sm">
                                    <SelectValue placeholder="DB 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {partitionItems.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                            {hasMultiWs ? `[${p.workspaceName}] ${p.name}` : p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {!isDraftRule && link.isActive !== 1 && (
                                <span className="text-xs text-muted-foreground">중지된 규칙입니다. 저장해도 중지 상태가 유지됩니다.</span>
                            )}
                            {isDraftRule && (
                                <Button variant="outline" onClick={() => handleSave(true)} disabled={saving}>
                                    {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    임시저장
                                </Button>
                            )}
                            <Button onClick={() => handleSave(false)} disabled={saving || !recipientField || !companyField}>
                                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                {isDraftRule ? "정식 저장" : "수정"}
                            </Button>
                        </div>
                    </div>

                    <div className="flex gap-6">
                        {/* Left: Form */}
                        <div className="flex-1 min-w-0 space-y-6">
                            {/* 발신 설정 — 묶음은 한도·웜업에 따라 하루 보낼 수 있는 양을 정하므로 맨 위에서 바로 보이게 둔다 */}
                            <Card id="section-sender">
                                <CardHeader>
                                    <CardTitle>발신 설정</CardTitle>
                                    <CardDescription>발신 이메일과 서명 선택 (미선택 시 기본값 사용)</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>
                                            발신 프로필
                                            <HelpTip text="여러 개를 고르면 메일마다 오늘 보낼 수 있는 프로필 중 가장 오래 쉰 프로필로 나눠 보냅니다. 프로필별 하루 한도·웜업은 이메일 설정에서 정합니다." />
                                        </Label>
                                        <SenderPoolField value={senderProfileIds} onChange={setSenderProfileIds} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>서명</Label>
                                        <Select
                                            value={signatureId ? String(signatureId) : "default"}
                                            onValueChange={(v) => setSignatureId(v === "default" ? null : Number(v))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="default">기본 서명</SelectItem>
                                                {signatures.map((s) => (
                                                    <SelectItem key={s.id} value={String(s.id)}>
                                                        {s.name}{s.isDefault ? " (기본)" : ""}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Card 1: 기본 정보 */}
                            <Card id="section-basic">
                                <CardHeader>
                                    <CardTitle>기본 정보</CardTitle>
                                    <CardDescription>제품, 트리거, 수신자 설정</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>규칙명 <HelpTip text="발송 이력에서 이 규칙을 식별하기 위한 이름입니다." /></Label>
                                        <Input
                                            placeholder="예: 신규 리드 콜드메일"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            maxLength={100}
                                        />
                                    </div>
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
                                            CTA 링크 URL
                                            <HelpTip text="이메일 본문에 사용할 CTA 링크입니다. UTM 파라미터까지 직접 작성하세요. 비워두면 제품의 기본 URL이 사용됩니다." />
                                        </Label>
                                        <Input
                                            placeholder={selectedProduct?.url || "https://example.com/?utm_source=owned&utm_medium=email&utm_campaign=cold"}
                                            value={ctaUrl}
                                            onChange={(e) => setCtaUrl(e.target.value)}
                                            maxLength={500}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            입력한 URL이 그대로 사용됩니다 (UTM 자동 부착 없음). 비워두면 제품 URL 사용.
                                        </p>
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
                                            <HelpTip text="직접 입력하면 형식/톤 설정 대신 이 내용이 사용됩니다. ##필드명## 형태로 수신자 정보를 끼워 넣을 수 있습니다." />
                                        </Label>
                                        <PromptWithVariableInsert
                                            value={prompt}
                                            onChange={setPrompt}
                                            fields={fields.map((f) => ({ key: f.key, label: f.label }))}
                                            placeholder="직접 지시사항을 입력하면 아래 형식/톤 설정 대신 이 내용이 사용됩니다. 우측 '변수 삽입' 버튼으로 수신자 정보를 끼워넣을 수 있어요."
                                            rows={5}
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
                                                <Select value={tone || "default"} onValueChange={(v) => setTone(v === "default" ? "" : v)}>
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

                                    <div className="space-y-2">
                                        <Label>AI 모델</Label>
                                        <Select value={model} onValueChange={setModel}>
                                            <SelectTrigger>
                                                <SelectValue placeholder="모델 선택" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {AI_MODELS.map((m) => (
                                                    <SelectItem key={m.id} value={m.id}>
                                                        {m.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">
                                            첫 메일과 후속 메일 모두 이 모델로 생성됩니다. (회사 리서치는 Gemini 고정)
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>
                                            이미지 에셋
                                            <HelpTip text="선택한 이미지 URL이 프롬프트에 전달되어 AI가 본문에 <img>로 배치합니다. 에셋 탭에서 업로드한 이미지를 재사용합니다." />
                                        </Label>
                                        <AssetPickerField value={assetIds} onChange={setAssetIds} />
                                    </div>

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

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label>수신거부 링크 삽입</Label>
                                            <p className="text-xs text-muted-foreground">본문 하단에 수신거부 링크 추가. 거부한 주소에는 이후 발송되지 않음</p>
                                        </div>
                                        <Switch checked={useUnsubscribe} onCheckedChange={setUseUnsubscribe} />
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <Label>중복 발송 방지</Label>
                                            <p className="text-xs text-muted-foreground">같은 수신자에게 이미 발송된 이력이 있으면 재발송하지 않습니다.</p>
                                        </div>
                                        <Switch checked={preventDuplicate === 1} onCheckedChange={(v) => setPreventDuplicate(v ? 1 : 0)} />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Card 4: 발송 조건 */}
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
                                    <button onClick={() => document.getElementById("section-sender")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">발신 설정</button>
                                    <span className="text-muted-foreground">/</span>
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
                                        <div className="flex justify-between gap-3">
                                            <span className="shrink-0 text-muted-foreground">발신</span>
                                            <SenderPoolSummary ids={senderProfileIds} className="min-w-0" />
                                        </div>
                                        <RuleQueueSummary ids={senderProfileIds} linkId={linkId} savedIds={savedSenderIds} />
                                        <ReplyToSummaryRow ids={senderProfileIds} />
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
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">중복 방지</span>
                                            <Badge variant={preventDuplicate === 1 ? "default" : "outline"}>
                                                {preventDuplicate === 1 ? "ON" : "OFF"}
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
                                                <Badge>
                                                    {Array.isArray(followupConfig)
                                                        ? `${followupConfig.length}단계`
                                                        : `${followupConfig.delayDays}일 후`}
                                                </Badge>
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

                <AlertDialog open={pendingPartitionId !== null} onOpenChange={(open) => { if (!open) cancelPartitionChange(); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>DB를 변경하시겠습니까?</AlertDialogTitle>
                            <AlertDialogDescription>
                                {pendingFieldsError
                                    ? "새 DB의 필드를 불러오지 못해 호환 여부를 확인할 수 없습니다. 다시 시도해주세요."
                                    : !pendingFieldsReady
                                        ? "새 DB의 필드를 확인하는 중입니다..."
                                        : fieldsToReset.length === 0
                                            ? "기존 설정이 모두 호환됩니다. 그대로 적용됩니다."
                                            : "새 DB에 동일한 필드가 없어 다음 항목이 초기화됩니다. 변경 후 다시 선택해주세요."}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {pendingFieldsError != null && (
                            <Button variant="outline" size="sm" className="self-start" onClick={() => reloadPendingFields()}>
                                다시 시도
                            </Button>
                        )}
                        {fieldsToReset.length > 0 && (
                            <ul className="text-sm text-foreground bg-muted/50 rounded p-3 space-y-1">
                                {fieldsToReset.map((f) => (
                                    <li key={f.key}>
                                        • <span className="font-medium">{f.key}</span>
                                        <span className="text-muted-foreground"> (기존: {f.label})</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <AlertDialogFooter>
                            <AlertDialogCancel onClick={cancelPartitionChange}>취소</AlertDialogCancel>
                            <AlertDialogAction onClick={confirmPartitionChange} disabled={!pendingFieldsReady}>
                                {pendingFieldsLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                변경
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {confirmationDialog}

                <AsyncAlertDialog
                    open={experimentImpact !== null}
                    onOpenChange={(open) => { if (!open) setExperimentImpact(null); }}
                    title="진행 중인 문구 실험이 있습니다"
                    description={"이 변경을 저장하면 아래 실험이 비교하는 규칙 조건이 달라져, 다음 발송 준비 때 실험이 무효화됩니다.\n이미 실험에 배정된 미발송 메일은 실험을 종료할 때까지 보류됩니다. 이메일 > 문구 실험에서 실험을 종료하며 남은 메일을 계속 보낼지 취소할지 고를 수 있습니다."}
                    confirmLabel="그래도 저장"
                    pendingLabel="저장 중..."
                    onConfirm={async () => {
                        if (!experimentImpact) return;
                        await submit(experimentImpact.asDraft, true);
                    }}
                >
                    <ul className="text-sm bg-muted/50 rounded p-3 space-y-1">
                        {experimentImpact?.experiments.map((e) => (
                            <li key={e.id}>
                                • <span className="font-medium">{e.name}</span>
                                <span className="text-muted-foreground"> ({EXPERIMENT_STATE_LABELS[e.state] ?? e.state})</span>
                            </li>
                        ))}
                    </ul>
                    <Button variant="link" className="h-auto p-0 self-start" onClick={() => router.push("/email?tab=experiments")}>
                        문구 실험 보기
                    </Button>
                </AsyncAlertDialog>
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
