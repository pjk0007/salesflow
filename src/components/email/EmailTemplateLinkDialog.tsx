import { useState, useEffect } from "react";
import { useEmailTemplates } from "@/hooks/useEmailTemplates";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { extractEmailVariables } from "@/lib/email-utils";
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import type { EmailTemplateLink } from "@/lib/db";
import type { FieldDefinition } from "@/types";

interface EmailTemplateLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    link: EmailTemplateLink | null;
    fields: FieldDefinition[];
}

export default function EmailTemplateLinkDialog({
    open,
    onOpenChange,
    partitionId,
    link,
    fields,
}: EmailTemplateLinkDialogProps) {
    const { templates: allTemplates } = useEmailTemplates();
    const templates = allTemplates.filter((t) => t.status !== "draft");
    const { createLink, updateLink } = useEmailTemplateLinks(partitionId);
    const [saving, setSaving] = useState(false);

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

    useEffect(() => {
        if (link) {
            setName(link.name);
            setEmailTemplateId(link.emailTemplateId);
            setRecipientField(link.recipientField);
            setVariableMappings((link.variableMappings as Record<string, string>) || {});
            setTriggerType(link.triggerType);
            setTriggerCondition(link.triggerCondition ?? null);
            setUseRepeat(!!link.repeatConfig);
            setRepeatConfig(link.repeatConfig ?? null);
        } else {
            setName("");
            setEmailTemplateId(null);
            setRecipientField("");
            setVariableMappings({});
            setTriggerType("manual");
            setTriggerCondition(null);
            setUseRepeat(false);
            setRepeatConfig(null);
        }
    }, [link, open]);

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
            const data = {
                partitionId,
                name,
                emailTemplateId,
                recipientField,
                variableMappings: Object.keys(variableMappings).length > 0 ? variableMappings : undefined,
                triggerType,
                triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                repeatConfig: triggerType !== "manual" && useRepeat ? repeatConfig : null,
            };

            const result = link
                ? await updateLink(link.id, data)
                : await createLink(data);

            if (result.success) {
                toast.success(link ? "연결이 수정되었습니다." : "연결이 생성되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "저장에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{link ? "연결 편집" : "새 연결"}</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
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
                        <Input
                            value={recipientField}
                            onChange={(e) => setRecipientField(e.target.value)}
                            placeholder="email"
                        />
                    </div>

                    {variables.length > 0 && (
                        <div className="space-y-2">
                            <Label>변수 매핑</Label>
                            {variables.map((v) => (
                                <div key={v} className="flex items-center gap-2">
                                    <span className="text-sm font-mono w-[120px] shrink-0">{v}</span>
                                    <span className="text-muted-foreground">&rarr;</span>
                                    <Input
                                        value={variableMappings[v] || ""}
                                        onChange={(e) =>
                                            setVariableMappings((prev) => ({
                                                ...prev,
                                                [v]: e.target.value,
                                            }))
                                        }
                                        placeholder="필드명"
                                        className="flex-1"
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="border-t pt-4 space-y-4">
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
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        취소
                    </Button>
                    <Button onClick={handleSave} disabled={saving || !name || !emailTemplateId || !recipientField}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {link ? "수정" : "연결"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
