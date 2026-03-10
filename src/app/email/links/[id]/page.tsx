"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import WorkspaceLayout from "@/components/layouts/WorkspaceLayout";
import { PageContainer } from "@/components/common/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { useFields } from "@/hooks/useFields";
import { extractEmailVariables } from "@/lib/email-utils";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import { FollowupConfigForm } from "@/components/email/FollowupConfigForm";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function EditLinkPageContent() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const linkId = Number(params.id);
    const partitionId = Number(searchParams.get("partitionId"));

    const { data: allPartitionsData } = useSWR("/api/partitions", fetcher);
    const workspaceId = (allPartitionsData?.data as Array<{ id: number; workspaceId: number }>)
        ?.find((p) => p.id === partitionId)?.workspaceId ?? null;

    const { templates: allTemplates } = useEmailTemplates();
    const templates = allTemplates.filter((t) => t.status !== "draft");
    const { templateLinks, isLoading, updateLink } = useEmailTemplateLinks(partitionId || null);
    const { fields } = useFields(workspaceId);
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
            setLoaded(true);
        }
    }, [link, loaded]);

    const selectedTemplate = templates.find((t) => t.id === emailTemplateId);
    const variables = selectedTemplate
        ? extractEmailVariables(selectedTemplate.subject + " " + selectedTemplate.htmlBody)
        : [];

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
            <PageContainer>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" onClick={() => router.push("/email?tab=links")}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <h1 className="text-xl font-semibold">연결 편집</h1>
                    </div>
                    <Button onClick={handleSave} disabled={saving || !name || !emailTemplateId || !recipientField}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        수정
                    </Button>
                </div>

                <div className="max-w-2xl space-y-6">
                    <div className="space-y-2">
                        <Label>연결 이름</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="신규 고객 환영 이메일"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>이메일 템플릿</Label>
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
                        <Label>수신 이메일 필드</Label>
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
                            <Label>변수 매핑</Label>
                            {variables.map((v) => (
                                <div key={v} className="flex items-center gap-2">
                                    <span className="text-sm font-mono w-[120px] shrink-0">{v}</span>
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

                    <div className="border-t pt-6 space-y-4">
                        <h4 className="font-medium">자동 발송 설정</h4>

                        <div className="space-y-2">
                            <Label>발송 방식</Label>
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
                                    <Switch checked={useRepeat} onCheckedChange={setUseRepeat} />
                                    <Label>반복 발송 사용</Label>
                                </div>

                                {useRepeat && (
                                    <RepeatConfigForm
                                        fields={fields}
                                        value={repeatConfig}
                                        onChange={setRepeatConfig}
                                    />
                                )}
                            </>
                        )}
                    </div>

                    <div className="border-t pt-6">
                        <FollowupConfigForm
                            mode="template"
                            value={followupConfig}
                            onChange={setFollowupConfig}
                            templates={templates}
                        />
                    </div>
                </div>
            </PageContainer>
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
