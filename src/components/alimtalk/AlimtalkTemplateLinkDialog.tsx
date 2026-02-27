import { useState, useEffect } from "react";
import { useAlimtalkSenders } from "@/hooks/useAlimtalkSenders";
import { useAlimtalkTemplates } from "@/hooks/useAlimtalkTemplates";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
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
import TriggerConditionForm from "@/components/alimtalk/TriggerConditionForm";
import RepeatConfigForm from "@/components/alimtalk/RepeatConfigForm";
import type { AlimtalkTemplateLink } from "@/lib/db";
import type { FieldDefinition } from "@/types";

interface AlimtalkTemplateLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    link: AlimtalkTemplateLink | null;
    fields: FieldDefinition[];
}

export default function AlimtalkTemplateLinkDialog({
    open,
    onOpenChange,
    partitionId,
    link,
    fields,
}: AlimtalkTemplateLinkDialogProps) {
    const { senders } = useAlimtalkSenders();
    const [senderKey, setSenderKey] = useState("");
    const { templates } = useAlimtalkTemplates(senderKey || null);
    const { createLink, updateLink } = useAlimtalkTemplateLinks(partitionId);
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

    useEffect(() => {
        if (link) {
            setName(link.name);
            setSenderKey(link.senderKey);
            setTemplateCode(link.templateCode);
            setRecipientField(link.recipientField);
            setVariableMappings((link.variableMappings as Record<string, string>) || {});
            setTriggerType(link.triggerType);
            setTriggerCondition(link.triggerCondition ?? null);
            setUseRepeat(!!link.repeatConfig);
            setRepeatConfig(link.repeatConfig ?? null);
        } else {
            setName("");
            setSenderKey("");
            setTemplateCode("");
            setRecipientField("");
            setVariableMappings({});
            setTriggerType("manual");
            setTriggerCondition(null);
            setUseRepeat(false);
            setRepeatConfig(null);
        }
    }, [link, open]);

    const selectedTemplate = templates.find((t) => t.templateCode === templateCode);
    const variables = selectedTemplate
        ? [...new Set(selectedTemplate.templateContent.match(/#\{([^}]+)\}/g) || [])]
              .map((v) => v.slice(2, -1))
        : [];

    const handleSenderKeyChange = (key: string) => {
        setSenderKey(key);
        setTemplateCode("");
        setVariableMappings({});
    };

    const handleSave = async () => {
        if (!name || !senderKey || !templateCode || !recipientField) {
            toast.error("필수 항목을 입력해주세요.");
            return;
        }
        setSaving(true);
        try {
            const result = link
                ? await updateLink(link.id, {
                      name,
                      recipientField,
                      variableMappings: Object.keys(variableMappings).length > 0 ? variableMappings : undefined,
                      triggerType,
                      triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                      repeatConfig: triggerType !== "manual" && useRepeat ? repeatConfig : null,
                  })
                : await createLink({
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
                  });

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
                            placeholder="고객 가입 알림"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>발신프로필</Label>
                        <Select
                            value={senderKey}
                            onValueChange={handleSenderKeyChange}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="발신프로필 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {senders.map((s) => (
                                    <SelectItem key={s.senderKey} value={s.senderKey}>
                                        {s.plusFriendId}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>알림톡 템플릿</Label>
                        <Select
                            value={templateCode}
                            onValueChange={setTemplateCode}
                            disabled={!senderKey}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={senderKey ? "템플릿 선택" : "발신프로필을 먼저 선택하세요"} />
                            </SelectTrigger>
                            <SelectContent>
                                {templates.map((t) => (
                                    <SelectItem key={t.templateCode} value={t.templateCode}>
                                        {t.templateName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>수신 전화번호 필드</Label>
                        <Select
                            value={recipientField}
                            onValueChange={setRecipientField}
                        >
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
                    <Button onClick={handleSave} disabled={saving || !name || !senderKey || !templateCode || !recipientField}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {link ? "수정" : "연결"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
