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
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { useResolvedFields } from "@/hooks/useResolvedFields";
import { extractEmailVariables } from "@/lib/email-utils";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import { FollowupConfigForm } from "@/components/email/FollowupConfigForm";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동",
    on_create: "생성 시",
    on_update: "수정 시",
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

function EditLinkPageContent() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const linkId = Number(params.id);
    const partitionId = Number(searchParams.get("partitionId"));

    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);
    const { templates: allTemplates } = useEmailTemplates();
    const templates = allTemplates.filter((t) => t.status !== "draft");
    const { templateLinks, isLoading, updateLink } = useEmailTemplateLinks(partitionId || null);
    const { fields } = useResolvedFields(partitionId || null);
    const link = templateLinks.find((l) => l.id === linkId);

    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [name, setName] = useState("");
    const [emailTemplateId, setEmailTemplateId] = useState<number | null>(null);
    const [recipientField, setRecipientField] = useState("");
    const [variableMappings, setVariableMappings] = useState<Record<string, string>>({});
    const [triggerType, setTriggerType] = useState("manual");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [triggerCondition, setTriggerCondition] = useState<any>(null);
    const [useRepeat, setUseRepeat] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [repeatConfig, setRepeatConfig] = useState<any>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [followupConfig, setFollowupConfig] = useState<any>(null);
    const [preventDuplicate, setPreventDuplicate] = useState(0);

    useEffect(() => {
        if (link && !loaded) {
            setName(link.name);
            setEmailTemplateId(link.emailTemplateId);
            setRecipientField(link.recipientField);
            setVariableMappings((link.variableMappings as Record<string, string>) || {});
            setTriggerType(link.triggerType);
            setTriggerCondition(link.triggerCondition ?? null);
            setUseRepeat(!!link.repeatConfig);
            setRepeatConfig(link.repeatConfig ?? null);
            setFollowupConfig(link.followupConfig ?? null);
            setPreventDuplicate(link.preventDuplicate ?? 0);
            setLoaded(true);
        }
    }, [link, loaded]);

    const selectedTemplate = templates.find((t) => t.id === emailTemplateId);
    const variables = selectedTemplate
        ? extractEmailVariables(selectedTemplate.subject + " " + selectedTemplate.htmlBody)
        : [];

    const mappedCount = Object.values(variableMappings).filter(Boolean).length;

    const handleSave = async () => {
        if (!name || !emailTemplateId || !recipientField) {
            toast.error("필수 항목을 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            const result = await updateLink(linkId, {
                name,
                emailTemplateId,
                recipientField,
                variableMappings: Object.keys(variableMappings).length > 0 ? variableMappings : undefined,
                triggerType,
                triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                repeatConfig: triggerType !== "manual" && useRepeat ? repeatConfig : null,
                followupConfig: followupConfig || null,
                preventDuplicate,
            });
            if (result.success) {
                toast.success("연결이 수정되었습니다.");
                router.push("/email?tab=links");
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
                    연결을 찾을 수 없습니다.
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
                            <Button variant="ghost" size="icon" onClick={() => router.push("/email?tab=links")}>
                                <ArrowLeft className="h-5 w-5" />
                            </Button>
                            <h1 className="text-xl font-semibold">연결 편집</h1>
                            <span className="text-sm text-muted-foreground">
                                {(() => { const items = (allPartitionsData?.data as Array<{ id: number; name: string; workspaceId: number; workspaceName: string }>) ?? []; const p = items.find((x) => x.id === partitionId); if (!p) return ""; const multi = new Set(items.map((x) => x.workspaceId)).size > 1; return multi ? `[${p.workspaceName}] ${p.name}` : p.name; })()}
                            </span>
                        </div>
                        <Button onClick={handleSave} disabled={saving || !name || !emailTemplateId || !recipientField}>
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
                                    <CardDescription>연결 이름과 이메일 템플릿, 수신자 설정</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>
                                            연결 이름
                                            <HelpTip text="목록에서 구분하기 위한 이름입니다" />
                                        </Label>
                                        <Input
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder="신규 고객 환영 이메일"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label>
                                            이메일 템플릿
                                            <HelpTip text="발송할 이메일 템플릿을 선택하세요. 임시저장(draft) 상태는 제외됩니다." />
                                        </Label>
                                        <Select
                                            value={emailTemplateId ? String(emailTemplateId) : ""}
                                            onValueChange={(v) => setEmailTemplateId(Number(v))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="템플릿 선택" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {templates.map((t) => (
                                                    <SelectItem key={t.id} value={String(t.id)}>
                                                        {t.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>
                                            수신 이메일 필드
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

                                    {variables.length > 0 && (
                                        <div className="space-y-2">
                                            <Label>
                                                변수 매핑
                                                <HelpTip text="템플릿의 {{변수}}를 레코드 필드와 연결합니다" />
                                            </Label>
                                            {variables.map((v) => (
                                                <div key={v} className="flex items-center gap-2">
                                                    <span className="text-sm font-mono w-30 shrink-0">{v}</span>
                                                    <span className="text-muted-foreground">&rarr;</span>
                                                    <Select
                                                        value={variableMappings[v] || ""}
                                                        onValueChange={(val) =>
                                                            setVariableMappings((prev) => ({ ...prev, [v]: val }))
                                                        }
                                                    >
                                                        <SelectTrigger className="flex-1">
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
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Card 2: 자동 발송 설정 */}
                            <Card id="section-trigger">
                                <CardHeader>
                                    <CardTitle>자동 발송 설정</CardTitle>
                                    <CardDescription>발송 방식과 조건, 반복 설정</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>
                                            발송 방식
                                            <HelpTip text="수동: 직접 발송 / 생성 시: 레코드 생성 시 자동 / 수정 시: 레코드 수정 시 자동" />
                                        </Label>
                                        <Select value={triggerType} onValueChange={setTriggerType}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="manual">수동</SelectItem>
                                                <SelectItem value="on_create">생성 시</SelectItem>
                                                <SelectItem value="on_update">수정 시</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    {triggerType !== "manual" && (
                                        <>
                                            <TriggerConditionForm
                                                fields={fields}
                                                value={triggerCondition}
                                                onChange={setTriggerCondition}
                                            />

                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={useRepeat}
                                                    onCheckedChange={(v) => {
                                                        setUseRepeat(v);
                                                        if (v) setFollowupConfig(null);
                                                    }}
                                                    disabled={!!followupConfig}
                                                />
                                                <Label className={followupConfig ? "text-muted-foreground" : ""}>
                                                    반복 발송 사용
                                                    {followupConfig && <span className="text-xs ml-1">(후속 발송과 동시 사용 불가)</span>}
                                                </Label>
                                            </div>

                                            {useRepeat && (
                                                <RepeatConfigForm
                                                    fields={fields}
                                                    value={repeatConfig}
                                                    onChange={setRepeatConfig}
                                                />
                                            )}

                                            <div className="flex items-center gap-2">
                                                <Switch
                                                    checked={preventDuplicate === 1}
                                                    onCheckedChange={(v) => setPreventDuplicate(v ? 1 : 0)}
                                                />
                                                <div>
                                                    <Label>중복 발송 방지</Label>
                                                    <p className="text-xs text-muted-foreground">같은 수신자에게 이미 발송된 이력이 있으면 재발송하지 않습니다.</p>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Card 3: 후속 발송 */}
                            <Card id="section-followup" className={useRepeat ? "opacity-60" : ""}>
                                <CardHeader>
                                    <CardTitle>
                                        후속 발송
                                        {useRepeat && <span className="text-xs font-normal text-muted-foreground ml-2">(반복 발송과 동시 사용 불가)</span>}
                                    </CardTitle>
                                    <CardDescription>일정 기간 후 읽음 여부에 따라 후속 이메일 발송</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {useRepeat ? (
                                        <p className="text-sm text-muted-foreground">반복 발송 사용 중에는 후속 발송을 설정할 수 없습니다.</p>
                                    ) : (
                                        <FollowupConfigForm
                                            mode="template"
                                            value={followupConfig}
                                            onChange={setFollowupConfig}
                                            templates={templates}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* Right: Summary Panel */}
                        <div className="hidden lg:block w-[320px] shrink-0">
                            <div className="sticky top-6 space-y-4">
                                {/* Section Anchors */}
                                <div className="flex gap-2 text-sm">
                                    <button onClick={() => document.getElementById("section-basic")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">기본 정보</button>
                                    <span className="text-muted-foreground">/</span>
                                    <button onClick={() => document.getElementById("section-trigger")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">자동 발송</button>
                                    <span className="text-muted-foreground">/</span>
                                    <button onClick={() => document.getElementById("section-followup")?.scrollIntoView({ behavior: "smooth" })} className="text-muted-foreground hover:text-foreground transition-colors">후속 발송</button>
                                </div>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm">요약</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">연결 이름</span>
                                            <span className="font-medium truncate ml-2 max-w-40">{name || "—"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">템플릿</span>
                                            <span className="font-medium truncate ml-2 max-w-40">{selectedTemplate?.name || "—"}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">수신 필드</span>
                                            <span className="font-medium">{recipientField || "—"}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted-foreground">발송 방식</span>
                                            <Badge variant={triggerType === "manual" ? "outline" : "default"}>
                                                {TRIGGER_LABELS[triggerType]}
                                            </Badge>
                                        </div>
                                        {variables.length > 0 && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">변수 매핑</span>
                                                <span className="font-medium">{mappedCount}/{variables.length}개</span>
                                            </div>
                                        )}
                                        {triggerType !== "manual" && (
                                            <div className="flex justify-between">
                                                <span className="text-muted-foreground">반복 발송</span>
                                                <Badge variant={useRepeat ? "default" : "outline"}>
                                                    {useRepeat ? "ON" : "OFF"}
                                                </Badge>
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
            </TooltipProvider>
        </WorkspaceLayout>
    );
}

export default function EditLinkPage() {
    return (
        <Suspense>
            <EditLinkPageContent />
        </Suspense>
    );
}
