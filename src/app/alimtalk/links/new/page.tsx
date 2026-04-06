"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
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
import { useFields } from "@/hooks/useFields";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);
    const workspaceId = (allPartitionsData?.data as Array<{ id: number; workspaceId: number }>)
        ?.find((p) => p.id === partitionId)?.workspaceId ?? null;

    const { senders } = useAlimtalkSenders();
    const [senderKey, setSenderKey] = useState("");
    const { templates } = useAlimtalkTemplates(senderKey || null);
    const { createLink } = useAlimtalkTemplateLinks(partitionId || null);
    const { fields } = useFields(workspaceId);

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

    // 후속발송
    const [useFollowup, setUseFollowup] = useState(false);
    const [followupDelayDays, setFollowupDelayDays] = useState(3);
    const [followupSenderKey, setFollowupSenderKey] = useState("");
    const { templates: followupTemplates } = useAlimtalkTemplates(followupSenderKey || senderKey || null);
    const [followupTemplateCode, setFollowupTemplateCode] = useState("");
    const [followupVariableMappings, setFollowupVariableMappings] = useState<Record<string, string>>({});

    const selectedTemplate = templates.find((t) => t.templateCode === templateCode);
    const templateVariables = selectedTemplate?.templateContent?.match(/#\{[^}]+\}/g) || [];
    const selectedFollowupTemplate = followupTemplates.find((t) => t.templateCode === followupTemplateCode);
    const followupTemplateVariables = selectedFollowupTemplate?.templateContent?.match(/#\{[^}]+\}/g) || [];

    const handleSave = async () => {
        if (!name || !senderKey || !templateCode || !recipientField) {
            toast.error("필수 항목을 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            const followupConfig = useFollowup && followupTemplateCode ? {
                delayDays: followupDelayDays,
                templateCode: followupTemplateCode,
                templateName: followupTemplates.find((t) => t.templateCode === followupTemplateCode)?.templateName,
                ...(Object.keys(followupVariableMappings).length > 0 && { variableMappings: followupVariableMappings }),
            } : null;

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
                repeatConfig: triggerType !== "manual" && useRepeat ? repeatConfig : null,
                followupConfig,
                preventDuplicate: preventDuplicate === 1,
            });
            if (result.success) {
                toast.success("연결이 생성되었습니다.");
                router.push("/alimtalk?tab=links");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    if (!selectedPartitionId) {
        const partitionList = (allPartitionsData?.data as Array<{ id: number; name: string; workspaceId: number }>) ?? [];
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
                                            <Switch checked={useRepeat} onCheckedChange={(v) => { setUseRepeat(v); if (v) setUseFollowup(false); }} disabled={useFollowup} />
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
                                ) : (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2">
                                            <Switch checked={useFollowup} onCheckedChange={(v) => { setUseFollowup(v); if (v) setUseRepeat(false); }} />
                                            <Label>후속 발송 사용</Label>
                                        </div>
                                        {useFollowup && (
                                            <>
                                                <div className="space-y-2">
                                                    <Label>대기 기간 (일)</Label>
                                                    <Input type="number" min={1} max={30} value={followupDelayDays}
                                                        onChange={(e) => setFollowupDelayDays(Number(e.target.value))} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>발신 프로필 (후속)</Label>
                                                    <Select value={followupSenderKey || senderKey} onValueChange={setFollowupSenderKey}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {senders.map((s) => (
                                                                <SelectItem key={s.senderKey} value={s.senderKey}>{s.plusFriendId || s.senderKey}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>후속 알림톡 템플릿</Label>
                                                    <Select value={followupTemplateCode} onValueChange={(v) => { setFollowupTemplateCode(v); setFollowupVariableMappings({}); }}>
                                                        <SelectTrigger><SelectValue placeholder="템플릿 선택" /></SelectTrigger>
                                                        <SelectContent>
                                                            {followupTemplates.map((t) => (
                                                                <SelectItem key={t.templateCode} value={t.templateCode}>{t.templateName || t.templateCode}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {followupTemplateVariables.length > 0 && (
                                                    <div className="space-y-2">
                                                        <Label>후속 템플릿 변수 매핑</Label>
                                                        {followupTemplateVariables.map((v) => (
                                                            <div key={v} className="flex items-center gap-2">
                                                                <span className="text-sm font-mono w-[140px] shrink-0">{v}</span>
                                                                <span className="text-muted-foreground">&rarr;</span>
                                                                <Select
                                                                    value={followupVariableMappings[v] || ""}
                                                                    onValueChange={(val) => setFollowupVariableMappings((prev) => ({ ...prev, [v]: val }))}
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
                                                    </div>
                                                )}
                                            </>
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
                                        {useFollowup && followupTemplateCode ? (
                                            <Badge>{followupDelayDays}일 후</Badge>
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
