"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout, { QueryErrorState } from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
import { useResolvedFields } from "@/hooks/useResolvedFields";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm, { DEFAULT_REPEAT_CONFIG } from "@/components/alimtalk/RepeatConfigForm";
import FollowupStepsForm, { type FollowupStepUI } from "@/components/alimtalk/FollowupStepsForm";
import { extractAllTemplateVariables, saveAlimtalkFollowupSteps } from "@/lib/alimtalk-template-utils";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동",
    on_create: "생성 시",
    on_update: "수정 시",
};

function NewAlimtalkLinkContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const partitionIdParam = searchParams.get("partitionId");
    const [selectedPartitionId, setSelectedPartitionId] = useState<number | null>(
        partitionIdParam ? Number(partitionIdParam) : null
    );
    const partitionId = selectedPartitionId ?? 0;

    const { data: allPartitionsData, error: partitionsError, mutate: mutatePartitions } = useSWR("/api/partitions", defaultFetcher);
    const { senders } = useAlimtalkSenders();
    const [senderKey, setSenderKey] = useState("");
    const { templates } = useAlimtalkTemplates(senderKey || null);
    const { createLink } = useAlimtalkTemplateLinks(partitionId || null);
    const { fields } = useResolvedFields(partitionId || null);

    const [saving, setSaving] = useState(false);
    const [name, setName] = useState("");
    const [templateCode, setTemplateCode] = useState("");
    const [recipientField, setRecipientField] = useState("");
    const [variableMappings, setVariableMappings] = useState<Record<string, string>>({});
    const [triggerType, setTriggerType] = useState("manual");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [triggerCondition, setTriggerCondition] = useState<any>(null);
    const [useRepeat, setUseRepeat] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [repeatConfig, setRepeatConfig] = useState<any>(null);
    const [preventDuplicate, setPreventDuplicate] = useState(0);

    // 후속발송 (다단계)
    const [useFollowup, setUseFollowup] = useState(false);
    const [followupSteps, setFollowupSteps] = useState<FollowupStepUI[]>([]);

    const selectedTemplate = templates.find((t) => t.templateCode === templateCode);
    const templateVariables = extractAllTemplateVariables(selectedTemplate ?? null);
    // 비운 변수는 발송 파라미터에서 빠져 공급자가 거절한다 — 저장 전에 막는다(UX-253, 서버도 같은 검사)
    const unmappedVariables = templateVariables.filter((v) => !variableMappings[v]);
    // 수동 발송은 후속 큐를 만들지 않는다 — 수동 연결의 후속은 저장하지 않는다(UX-188)
    const manualFollowup = triggerType === "manual" && useFollowup && followupSteps.some((s) => s.templateCode);

    const handleSave = async () => {
        if (!name || !senderKey || !templateCode || !recipientField) {
            toast.error("필수 항목을 입력해주세요.");
            return;
        }
        if (unmappedVariables.length > 0) {
            toast.error(`변수 ${unmappedVariables.length}개가 매핑되지 않았습니다.`);
            return;
        }
        if (manualFollowup) {
            toast.error("수동 연결에는 후속 발송을 설정할 수 없습니다. 발송 방식을 바꾸거나 후속 발송을 꺼주세요.");
            return;
        }
        setSaving(true);
        try {
            const validSteps = useFollowup && triggerType !== "manual"
                ? followupSteps.filter((s) => s.templateCode)
                : [];
            const followupConfig = validSteps.length > 0
                ? saveAlimtalkFollowupSteps(validSteps)
                : null;

            const result = await createLink({
                partitionId,
                name,
                senderKey,
                templateCode,
                templateName: selectedTemplate?.templateName,
                recipientField,
                variableMappings: Object.keys(variableMappings).length > 0 ? variableMappings : undefined,
                triggerType,
                triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                repeatConfig: triggerType !== "manual" && useRepeat ? repeatConfig ?? DEFAULT_REPEAT_CONFIG : null,
                followupConfig,
                preventDuplicate: preventDuplicate === 1,
            });
            if (result.success) {
                toast.success("연결이 생성되었습니다.");
                if (result.warning) toast.warning(result.warning);
                router.push("/alimtalk?tab=links");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } catch {
            // 연결 끊김·응답 해석 실패: 저장됐을 수 있다 — 입력은 그대로 두고 확인을 안내한다(UX-180)
            toast.error("저장 결과를 확인하지 못했습니다. 연결 목록에서 저장 여부를 확인한 뒤 다시 시도해주세요.");
        } finally {
            setSaving(false);
        }
    };

    if (partitionsError && !allPartitionsData) {
        return <WorkspaceLayout><QueryErrorState error={partitionsError} onRetry={() => mutatePartitions()} /></WorkspaceLayout>;
    }

    if (!selectedPartitionId) {
        const rawPartitions = (allPartitionsData?.data as Array<{ id: number; name: string; workspaceId: number; workspaceName: string }>) ?? [];
        const hasMultiWs = new Set(rawPartitions.map((p) => p.workspaceId)).size > 1;
        const partitionList = rawPartitions.map((p) => ({ ...p, name: hasMultiWs ? `[${p.workspaceName}] ${p.name}` : p.name }));
        return (
            <WorkspaceLayout>
                <PageContainer>
                    <div className="flex items-center gap-3 mb-6">
                        <Button variant="ghost" size="icon" onClick={() => router.push("/alimtalk?tab=links")}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <h1 className="text-xl font-semibold">새 알림톡 연결</h1>
                    </div>
                    <div className="flex flex-col items-center justify-center p-12 border rounded-lg border-dashed gap-4">
                        <p className="text-muted-foreground">연결할 파티션을 선택하세요.</p>
                        <Select onValueChange={(v) => setSelectedPartitionId(Number(v))}>
                            <SelectTrigger className="w-[300px]">
                                <SelectValue placeholder="파티션 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {partitionList.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
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
                        <Button variant="ghost" size="icon" onClick={() => router.push("/alimtalk?tab=links")}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <h1 className="text-xl font-semibold">새 알림톡 연결</h1>
                        <span className="text-sm text-muted-foreground">
                            {(() => { const items = (allPartitionsData?.data as Array<{ id: number; name: string; workspaceId: number; workspaceName: string }>) ?? []; const p = items.find((x) => x.id === partitionId); if (!p) return ""; const multi = new Set(items.map((x) => x.workspaceId)).size > 1; return multi ? `[${p.workspaceName}] ${p.name}` : p.name; })()}
                        </span>
                    </div>
                    <Button onClick={handleSave} disabled={saving || !name || !senderKey || !templateCode || !recipientField}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        저장
                    </Button>
                </div>

                <div className="flex gap-6">
                    {/* Left: Form */}
                    <div className="flex-1 min-w-0 space-y-6">
                        {/* 기본 정보 */}
                        <Card>
                            <CardHeader>
                                <CardTitle>기본 정보</CardTitle>
                                <CardDescription>연결 이름, 발신 프로필, 템플릿, 수신자 설정</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>연결 이름</Label>
                                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="신규 고객 환영 알림톡" />
                                </div>
                                <div className="space-y-2">
                                    <Label>발신 프로필</Label>
                                    <Select value={senderKey} onValueChange={(v) => { setSenderKey(v); setTemplateCode(""); }}>
                                        <SelectTrigger><SelectValue placeholder="발신 프로필 선택" /></SelectTrigger>
                                        <SelectContent>
                                            {senders.map((s) => (
                                                <SelectItem key={s.senderKey} value={s.senderKey}>{s.plusFriendId || s.senderKey}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>알림톡 템플릿</Label>
                                    <Select value={templateCode} onValueChange={setTemplateCode} disabled={!senderKey}>
                                        <SelectTrigger><SelectValue placeholder="템플릿 선택" /></SelectTrigger>
                                        <SelectContent>
                                            {templates.map((t) => (
                                                <SelectItem key={t.templateCode} value={t.templateCode}>{t.templateName || t.templateCode}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>수신 전화번호 필드</Label>
                                    <Select value={recipientField} onValueChange={setRecipientField}>
                                        <SelectTrigger><SelectValue placeholder="필드 선택" /></SelectTrigger>
                                        <SelectContent>
                                            {fields.map((f) => (
                                                <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {templateVariables.length > 0 && (
                                    <div className="space-y-2">
                                        <Label>변수 매핑</Label>
                                        {templateVariables.map((v) => (
                                            <div key={v} className="flex items-center gap-2">
                                                <span className="text-sm font-mono w-[140px] shrink-0">{v}</span>
                                                <span className="text-muted-foreground">&rarr;</span>
                                                <Select
                                                    value={variableMappings[v] || ""}
                                                    onValueChange={(val) => setVariableMappings((prev) => ({ ...prev, [v]: val }))}
                                                >
                                                    <SelectTrigger className="flex-1"><SelectValue placeholder="필드 선택" /></SelectTrigger>
                                                    <SelectContent>
                                                        {fields.map((f) => (
                                                            <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ))}
                                        {unmappedVariables.length > 0 && (
                                            <p className="text-xs text-destructive" role="alert">
                                                {unmappedVariables.length}개 미매핑 — 모든 변수를 필드에 연결해야 저장할 수 있습니다.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 자동 발송 설정 */}
                        <Card>
                            <CardHeader>
                                <CardTitle>자동 발송 설정</CardTitle>
                                <CardDescription>발송 방식과 조건, 반복 설정</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>발송 방식</Label>
                                    <Select value={triggerType} onValueChange={setTriggerType}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="manual">수동</SelectItem>
                                            <SelectItem value="on_create">생성 시</SelectItem>
                                            <SelectItem value="on_update">수정 시</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                {triggerType !== "manual" && (
                                    <>
                                        <TriggerConditionForm fields={fields} value={triggerCondition} onChange={setTriggerCondition} />
                                        <div className="flex items-center gap-2">
                                            <Switch checked={useRepeat} onCheckedChange={(v) => { setUseRepeat(v); if (v) { setUseFollowup(false); setRepeatConfig((c: typeof repeatConfig) => c ?? DEFAULT_REPEAT_CONFIG); } }} disabled={useFollowup} />
                                            <Label className={useFollowup ? "text-muted-foreground" : ""}>
                                                반복 발송{useFollowup && <span className="text-xs ml-1">(후속 발송과 동시 사용 불가)</span>}
                                            </Label>
                                        </div>
                                        {useRepeat && <RepeatConfigForm fields={fields} value={repeatConfig} onChange={setRepeatConfig} />}
                                        <div className="flex items-center gap-2">
                                            <Switch checked={preventDuplicate === 1} onCheckedChange={(v) => setPreventDuplicate(v ? 1 : 0)} />
                                            <div>
                                                <Label>중복 발송 방지</Label>
                                                <p className="text-xs text-muted-foreground">같은 수신자에게 이미 발송된 이력이 있으면 재발송하지 않습니다.</p>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {/* 후속 발송 */}
                        <Card className={useRepeat ? "opacity-60" : ""}>
                            <CardHeader>
                                <CardTitle>
                                    후속 발송
                                    {useRepeat && <span className="text-xs font-normal text-muted-foreground ml-2">(반복 발송과 동시 사용 불가)</span>}
                                </CardTitle>
                                <CardDescription>일정 기간 후 다른 알림톡 템플릿으로 후속 발송</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {useRepeat ? (
                                    <p className="text-sm text-muted-foreground">반복 발송 사용 중에는 후속 발송을 설정할 수 없습니다.</p>
                                ) : triggerType === "manual" && !useFollowup ? (
                                    <p className="text-sm text-muted-foreground">후속 발송은 &apos;생성 시&apos;·&apos;수정 시&apos; 자동 발송에서만 실행됩니다. 발송 방식을 바꾸면 설정할 수 있습니다.</p>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={useFollowup}
                                                onCheckedChange={(v) => {
                                                    setUseFollowup(v);
                                                    if (v) {
                                                        setUseRepeat(false);
                                                        if (followupSteps.length === 0) {
                                                            setFollowupSteps([{ delayValue: 3, delayUnit: "hours", senderKey: "", templateCode: "", variableMappings: {} }]);
                                                        }
                                                    }
                                                }}
                                            />
                                            <Label>후속 발송 사용</Label>
                                        </div>
                                        {manualFollowup && (
                                            <p className="text-sm text-destructive" role="alert">
                                                수동 연결에서는 후속 발송이 실행되지 않습니다. 발송 방식을 &apos;생성 시&apos;·&apos;수정 시&apos;로 바꾸거나 후속 발송을 꺼야 저장할 수 있습니다.
                                            </p>
                                        )}
                                        {useFollowup && (
                                            <FollowupStepsForm
                                                senderKey={senderKey}
                                                senders={senders}
                                                fields={fields}
                                                steps={followupSteps}
                                                onChange={setFollowupSteps}
                                                fallbackMappings={variableMappings}
                                            />
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right: Summary */}
                    <div className="hidden lg:block w-[300px] shrink-0">
                        <div className="sticky top-6">
                            <Card>
                                <CardHeader><CardTitle className="text-sm">요약</CardTitle></CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <div className="flex justify-between"><span className="text-muted-foreground">이름</span><span className="font-medium truncate ml-2 max-w-[140px]">{name || "—"}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">템플릿</span><span className="font-medium truncate ml-2 max-w-[140px]">{selectedTemplate?.templateName || "—"}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">수신 필드</span><span className="font-medium">{recipientField || "—"}</span></div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">발송 방식</span>
                                        <Badge variant={triggerType === "manual" ? "outline" : "default"}>{TRIGGER_LABELS[triggerType]}</Badge>
                                    </div>
                                    {triggerType !== "manual" && (
                                        <>
                                            <div className="flex justify-between"><span className="text-muted-foreground">반복</span><Badge variant={useRepeat ? "default" : "outline"}>{useRepeat ? "ON" : "OFF"}</Badge></div>
                                            <div className="flex justify-between"><span className="text-muted-foreground">중복방지</span><Badge variant={preventDuplicate ? "default" : "outline"}>{preventDuplicate ? "ON" : "OFF"}</Badge></div>
                                        </>
                                    )}
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">후속 발송</span>
                                        {useFollowup && followupSteps.some((s) => s.templateCode) ? (
                                            <Badge>{followupSteps.filter((s) => s.templateCode).length}단계</Badge>
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
        </WorkspaceLayout>
    );
}

export default function NewAlimtalkLinkPage() {
    return <Suspense><NewAlimtalkLinkContent /></Suspense>;
}
