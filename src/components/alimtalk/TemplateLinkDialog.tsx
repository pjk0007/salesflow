import { useState, useEffect } from "react";
import { usePartitions } from "@/hooks/usePartitions";
import { useFields } from "@/hooks/useFields";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import VariableMappingEditor from "./VariableMappingEditor";
import TriggerConditionForm from "./TriggerConditionForm";
import RepeatConfigForm from "./RepeatConfigForm";
import type { AlimtalkTemplateLink } from "@/lib/db";

interface TemplateLinkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    templateCode: string;
    templateName: string;
    templateContent: string;
    mode: "create" | "edit";
    existingLink?: AlimtalkTemplateLink;
}

export default function TemplateLinkDialog({
    open,
    onOpenChange,
    senderKey,
    templateCode,
    templateName,
    templateContent,
    mode,
    existingLink,
}: TemplateLinkDialogProps) {
    const { workspaces } = useWorkspaces();
    const [workspaceId, setWorkspaceId] = useState<number | null>(
        workspaces.length > 0 ? workspaces[0].id : null
    );
    const { partitionTree } = usePartitions(workspaceId);
    const { fields } = useFields(workspaceId);

    const [name, setName] = useState(existingLink?.name || templateName);
    const [partitionId, setPartitionId] = useState<number | null>(
        existingLink?.partitionId || null
    );
    const [recipientField, setRecipientField] = useState(
        existingLink?.recipientField || ""
    );
    const [variableMappings, setVariableMappings] = useState<Record<string, string>>(
        (existingLink?.variableMappings as Record<string, string>) || {}
    );
    const [triggerType, setTriggerType] = useState(existingLink?.triggerType || "manual");
    const [triggerCondition, setTriggerCondition] = useState<{
        field?: string;
        operator?: "eq" | "ne" | "contains";
        value?: string;
    } | null>((existingLink?.triggerCondition as { field?: string; operator?: "eq" | "ne" | "contains"; value?: string } | null) || null);
    const [repeatConfig, setRepeatConfig] = useState<{
        intervalHours: number;
        maxRepeat: number;
        stopCondition: { field: string; operator: "eq" | "ne"; value: string };
    } | null>((existingLink?.repeatConfig as { intervalHours: number; maxRepeat: number; stopCondition: { field: string; operator: "eq" | "ne"; value: string } } | null) || null);
    const [loading, setLoading] = useState(false);

    const { createLink, updateLink } = useAlimtalkTemplateLinks(partitionId);

    // 워크스페이스 자동 선택
    useEffect(() => {
        if (!workspaceId && workspaces.length > 0) {
            setWorkspaceId(workspaces[0].id);
        }
    }, [workspaces, workspaceId]);

    // 파티션 목록 생성
    const allPartitions = partitionTree
        ? [
              ...partitionTree.folders.flatMap((f) => f.partitions),
              ...partitionTree.ungrouped,
          ]
        : [];

    // phone 타입 필드 필터링
    const phoneFields = fields.filter(
        (f) => f.fieldType === "phone" || f.fieldType === "text"
    );

    const handleSubmit = async () => {
        if (!name || !partitionId || !recipientField) {
            toast.error("이름, 파티션, 수신번호 필드를 선택해주세요.");
            return;
        }

        setLoading(true);

        if (mode === "create") {
            const result = await createLink({
                partitionId,
                name,
                senderKey,
                templateCode,
                templateName,
                recipientField,
                variableMappings:
                    Object.keys(variableMappings).length > 0 ? variableMappings : undefined,
                triggerType,
                triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                repeatConfig: triggerType !== "manual" ? repeatConfig : null,
            });
            if (result.success) {
                toast.success("템플릿이 파티션에 연결되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "연결에 실패했습니다.");
            }
        } else if (existingLink) {
            const result = await updateLink(existingLink.id, {
                name,
                recipientField,
                variableMappings,
                triggerType,
                triggerCondition: triggerType !== "manual" ? triggerCondition : null,
                repeatConfig: triggerType !== "manual" ? repeatConfig : null,
            });
            if (result.success) {
                toast.success("템플릿 연결이 수정되었습니다.");
                onOpenChange(false);
            } else {
                toast.error(result.error || "수정에 실패했습니다.");
            }
        }

        setLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {mode === "create" ? "템플릿-파티션 연결" : "연결 수정"}
                    </DialogTitle>
                    <DialogDescription>
                        {templateName} ({templateCode})
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>연결 이름</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="연결 이름"
                        />
                    </div>

                    {mode === "create" && (
                        <div className="space-y-2">
                            <Label>파티션 선택</Label>
                            <Select
                                value={partitionId ? String(partitionId) : ""}
                                onValueChange={(v) => setPartitionId(Number(v))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="파티션 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {allPartitions.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>수신번호 필드</Label>
                        <Select
                            value={recipientField}
                            onValueChange={setRecipientField}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="수신번호로 사용할 필드" />
                            </SelectTrigger>
                            <SelectContent>
                                {phoneFields.map((field) => (
                                    <SelectItem key={field.key} value={field.key}>
                                        {field.label} ({field.fieldType})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <VariableMappingEditor
                        templateContent={templateContent}
                        fields={fields}
                        value={variableMappings}
                        onChange={setVariableMappings}
                    />

                    <div className="space-y-2">
                        <Label>발송 방식</Label>
                        <Select value={triggerType} onValueChange={setTriggerType}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="manual">수동 발송</SelectItem>
                                <SelectItem value="on_create">레코드 생성 시</SelectItem>
                                <SelectItem value="on_update">레코드 수정 시</SelectItem>
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
                            <RepeatConfigForm
                                fields={fields}
                                value={repeatConfig}
                                onChange={setRepeatConfig}
                            />
                        </>
                    )}

                    <Button
                        className="w-full"
                        onClick={handleSubmit}
                        disabled={loading || !name || !partitionId || !recipientField}
                    >
                        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        {mode === "create" ? "연결" : "수정"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
