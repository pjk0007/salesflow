"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
import { useResolvedFields } from "@/hooks/useResolvedFields";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TRIGGER_LABELS: Record<string, string> = {
    manual: "수동", on_create: "생성 시", on_update: "수정 시",
};

export default function EditAlimtalkLinkPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const linkId = Number(id);
    const router = useRouter();

    // 기존 연결 데이터 가져오기 — 먼저 partitionId 알아야 fields를 조회할 수 있음
    const [loaded, setLoaded] = useState(false);
    const [partitionId, setPartitionId] = useState<number | null>(null);

    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);
    const { senders } = useAlimtalkSenders();
    const [senderKey, setSenderKey] = useState("");
    const { templates } = useAlimtalkTemplates(senderKey || null);
    const { templateLinks, updateLink } = useAlimtalkTemplateLinks(partitionId);
    const { fields } = useResolvedFields(partitionId);

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
    const [isActive, setIsActive] = useState(1);

    const [useFollowup, setUseFollowup] = useState(false);
    const [followupDelayValue, setFollowupDelayValue] = useState(3);
    const [followupDelayUnit, setFollowupDelayUnit] = useState<"hours" | "days">("days");
    const [followupSenderKey, setFollowupSenderKey] = useState("");
    const { templates: followupTemplates } = useAlimtalkTemplates(followupSenderKey || senderKey || null);
    const [followupTemplateCode, setFollowupTemplateCode] = useState("");
    const [followupVariableMappings, setFollowupVariableMappings] = useState<Record<string, string>>({});

    const selectedFollowupTemplate = followupTemplates.find((t) => t.templateCode === followupTemplateCode);
    const followupTemplateVariables = selectedFollowupTemplate?.templateContent?.match(/#\{[^}]+\}/g) || [];

    // 기존 데이터 로드
    useEffect(() => {
        const link = templateLinks.find((l) => l.id === linkId);
        if (link && !loaded) {
            setPartitionId(link.partitionId);
            setName(link.name);
            setSenderKey(link.senderKey);
            setTemplateCode(link.templateCode);
            setRecipientField(link.recipientField);
            setVariableMappings((link.variableMappings as Record<string, string>) || {});
            setTriggerType(link.triggerType);
            setTriggerCondition(link.triggerCondition);
            setPreventDuplicate(link.preventDuplicate);
            setIsActive(link.isActive);
            if (link.repeatConfig) {
                setUseRepeat(true);
                setRepeatConfig(link.repeatConfig);
            }
            const fc = link.followupConfig as {
                delayDays?: number;
                delayHours?: number;
                delayMinutes?: number;
                templateCode: string;
                variableMappings?: Record<string, string>;
            } | null;
            if (fc) {
                setUseFollowup(true);
                if (fc.delayHours != null) {
                    setFollowupDelayUnit("hours");
                    setFollowupDelayValue(fc.delayHours);
                } else if (fc.delayMinutes != null) {
                    // 분 단위 데이터는 시간으로 환산 (최소 1시간)
                    setFollowupDelayUnit("hours");
                    setFollowupDelayValue(Math.max(1, Math.round(fc.delayMinutes / 60)));
                } else {
                    setFollowupDelayUnit("days");
                    setFollowupDelayValue(fc.delayDays ?? 1);
                }
                setFollowupTemplateCode(fc.templateCode);
                if (fc.variableMappings) setFollowupVariableMappings(fc.variableMappings);
            }
            setLoaded(true);
        }
    }, [templateLinks, linkId, loaded]);

    // partitionId를 먼저 찾기 위해 전체 링크 검색
    useEffect(() => {
        if (partitionId) return;
        // 모든 파티션에서 해당 링크 찾기
        if (allPartitionsData?.data) {
            for (const p of allPartitionsData.data as Array<{ id: number }>) {
                fetch(`/api/alimtalk/template-links?partitionId=${p.id}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d.data?.find((l: { id: number }) => l.id === linkId)) {
                            setPartitionId(p.id);
                        }
                    })
                    .catch(() => {});
            }
        }
    }, [allPartitionsData, linkId, partitionId]);

    const selectedTemplate = templates.find((t) => t.templateCode === templateCode);
    const templateVariables = selectedTemplate?.templateContent?.match(/#\{[^}]+\}/g) || [];

    const handleSave = async () => {
        setSaving(true);
        try {
            const followupConfig = useFollowup && followupTemplateCode ? {
                ...(followupDelayUnit === "hours" && { delayHours: followupDelayValue }),
                ...(followupDelayUnit === "days" && { delayDays: followupDelayValue }),
                templateCode: followupTemplateCode,
                templateName: followupTemplates.find((t) => t.templateCode === followupTemplateCode)?.templateName,
                ...(Object.keys(followupVariableMappings).length > 0 && { variableMappings: followupVariableMappings }),
            } : null;

            const result = await updateLink(linkId, {
                name,
                recipientField,
                variableMappings,
                isActive,
                triggerType,
                triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                repeatConfig: triggerType !== "manual" && useRepeat ? repeatConfig : null,
                followupConfig,
                preventDuplicate: preventDuplicate === 1,
            });
            if (result.success) {
                toast.success("연결이 수정되었습니다.");
                router.push("/alimtalk?tab=links");
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    if (!loaded) {
        return (
            <WorkspaceLayout>
                <PageContainer>
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                        <h1 className="text-xl font-semibold">알림톡 연결 수정</h1>
                        <span className="text-sm text-muted-foreground">
                            {(() => { const items = (allPartitionsData?.data as Array<{ id: number; name: string; workspaceId: number; workspaceName: string }>) ?? []; const p = items.find((x) => x.id === partitionId); if (!p) return ""; const multi = new Set(items.map((x) => x.workspaceId)).size > 1; return multi ? `[${p.workspaceName}] ${p.name}` : p.name; })()}
                        </span>
                        <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "활성" : "비활성"}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 mr-4">
                            <Switch checked={isActive === 1} onCheckedChange={(v) => setIsActive(v ? 1 : 0)} />
                            <Label className="text-sm">{isActive ? "활성" : "비활성"}</Label>
                        </div>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            저장
                        </Button>
                    </div>
                </div>

                <div className="flex gap-6">
                    <div className="flex-1 min-w-0 space-y-6">
                        {/* 기본 정보 */}
                        <Card>
                            <CardHeader>
                                <CardTitle>기본 정보</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>연결 이름</Label>
                                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>발신 프로필</Label>
                                    <Input value={senderKey} disabled className="bg-muted" />
                                </div>
                                <div className="space-y-2">
                                    <Label>템플릿</Label>
                                    <Input value={selectedTemplate?.templateName || templateCode} disabled className="bg-muted" />
                                </div>
                                <div className="space-y-2">
                                    <Label>수신 전화번호 필드</Label>
                                    <Select value={recipientField} onValueChange={setRecipientField}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
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
                                                <Select value={variableMappings[v] || ""} onValueChange={(val) => setVariableMappings((prev) => ({ ...prev, [v]: val }))}>
                                                    <SelectTrigger className="flex-1"><SelectValue placeholder="필드 선택" /></SelectTrigger>
                                                    <SelectContent>
                                                        {fields.map((f) => (<SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* 자동 발송 */}
                        <Card>
                            <CardHeader><CardTitle>자동 발송 설정</CardTitle></CardHeader>
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
                                            <Label>반복 발송</Label>
                                        </div>
                                        {useRepeat && <RepeatConfigForm fields={fields} value={repeatConfig} onChange={setRepeatConfig} />}
                                        <div className="flex items-center gap-2">
                                            <Switch checked={preventDuplicate === 1} onCheckedChange={(v) => setPreventDuplicate(v ? 1 : 0)} />
                                            <Label>중복 발송 방지</Label>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        {/* 후속 발송 */}
                        <Card className={useRepeat ? "opacity-60" : ""}>
                            <CardHeader>
                                <CardTitle>후속 발송</CardTitle>
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
                                                    <Label>대기 기간</Label>
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            type="number"
                                                            min={1}
                                                            max={followupDelayUnit === "hours" ? 720 : 30}
                                                            value={followupDelayValue}
                                                            onChange={(e) => setFollowupDelayValue(Number(e.target.value))}
                                                            className="w-24"
                                                        />
                                                        <ToggleGroup
                                                            type="single"
                                                            value={followupDelayUnit}
                                                            onValueChange={(v) => v && setFollowupDelayUnit(v as "hours" | "days")}
                                                            variant="outline"
                                                            size="sm"
                                                        >
                                                            <ToggleGroupItem value="hours" className="px-4">시간</ToggleGroupItem>
                                                            <ToggleGroupItem value="days" className="px-4">일</ToggleGroupItem>
                                                        </ToggleGroup>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        발송 후 {followupDelayValue}{followupDelayUnit === "hours" ? "시간" : "일"} 뒤 후속 발송됩니다
                                                    </p>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>발신 프로필 (후속)</Label>
                                                    <Select value={followupSenderKey || senderKey} onValueChange={setFollowupSenderKey}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {senders.map((s) => (<SelectItem key={s.senderKey} value={s.senderKey}>{s.plusFriendId || s.senderKey}</SelectItem>))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>후속 알림톡 템플릿</Label>
                                                    <Select value={followupTemplateCode} onValueChange={(v) => { setFollowupTemplateCode(v); setFollowupVariableMappings({}); }}>
                                                        <SelectTrigger><SelectValue placeholder="템플릿 선택" /></SelectTrigger>
                                                        <SelectContent>
                                                            {followupTemplates.map((t) => (<SelectItem key={t.templateCode} value={t.templateCode}>{t.templateName || t.templateCode}</SelectItem>))}
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
                                                                        {fields.map((f) => (<SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>))}
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
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">발송 방식</span>
                                        <Badge variant={triggerType === "manual" ? "outline" : "default"}>{TRIGGER_LABELS[triggerType]}</Badge>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">상태</span>
                                        <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "활성" : "비활성"}</Badge>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">후속 발송</span>
                                        {useFollowup && followupTemplateCode ? <Badge>{followupDelayValue}{followupDelayUnit === "hours" ? "시간" : "일"} 후</Badge> : <Badge variant="outline">OFF</Badge>}
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
