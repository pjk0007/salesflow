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
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
import { useResolvedFields } from "@/hooks/useResolvedFields";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import FollowupStepsForm, { type FollowupStepUI } from "@/components/alimtalk/FollowupStepsForm";
import { extractAllTemplateVariables } from "@/lib/alimtalk-template-utils";
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
    const [followupSteps, setFollowupSteps] = useState<FollowupStepUI[]>([]);

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
            type FollowupStepRaw = {
                delayDays?: number;
                delayHours?: number;
                delayMinutes?: number;
                templateCode: string;
                variableMappings?: Record<string, string>;
            };
            const fc = link.followupConfig as FollowupStepRaw | FollowupStepRaw[] | null;
            const rawSteps: FollowupStepRaw[] = !fc
                ? []
                : Array.isArray(fc)
                  ? fc
                  : [fc];
            if (rawSteps.length > 0) {
                setUseFollowup(true);
                setFollowupSteps(rawSteps.map((s): FollowupStepUI => {
                    if (s.delayHours != null) {
                        return { delayValue: s.delayHours, delayUnit: "hours", senderKey: "", templateCode: s.templateCode, variableMappings: s.variableMappings ?? {} };
                    }
                    if (s.delayMinutes != null) {
                        return { delayValue: Math.max(1, Math.round(s.delayMinutes / 60)), delayUnit: "hours", senderKey: "", templateCode: s.templateCode, variableMappings: s.variableMappings ?? {} };
                    }
                    return { delayValue: s.delayDays ?? 1, delayUnit: "days", senderKey: "", templateCode: s.templateCode, variableMappings: s.variableMappings ?? {} };
                }));
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
    const templateVariables = extractAllTemplateVariables(selectedTemplate ?? null);

    const handleSave = async () => {
        setSaving(true);
        try {
            const validSteps = useFollowup
                ? followupSteps.filter((s) => s.templateCode)
                : [];
            const followupConfig = validSteps.length > 0
                ? validSteps.map((s) => ({
                    ...(s.delayUnit === "hours" && { delayHours: s.delayValue }),
                    ...(s.delayUnit === "days" && { delayDays: s.delayValue }),
                    templateCode: s.templateCode,
                    ...(Object.keys(s.variableMappings).length > 0 && { variableMappings: s.variableMappings }),
                }))
                : null;

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
                                        {useFollowup && (
                                            <FollowupStepsForm
                                                senderKey={senderKey}
                                                senders={senders}
                                                fields={fields}
                                                steps={followupSteps}
                                                onChange={setFollowupSteps}
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
                                        {useFollowup && followupSteps.some((s) => s.templateCode) ? <Badge>{followupSteps.filter((s) => s.templateCode).length}단계</Badge> : <Badge variant="outline">OFF</Badge>}
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
