import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, UserRound, Home, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import IconPicker from "@/components/ui/icon-picker";
import { FIELD_TEMPLATES } from "@/lib/field-templates";
import type { CreateWorkspaceInput } from "@/types";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Building2,
    UserRound,
    Home,
    Users,
};

interface CreateWorkspaceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (input: CreateWorkspaceInput) => Promise<{ success: boolean; error?: string; data?: { id: number } }>;
}

export default function CreateWorkspaceDialog({
    open,
    onOpenChange,
    onSubmit,
}: CreateWorkspaceDialogProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [icon, setIcon] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [step, setStep] = useState<"info" | "template">("info");
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [createdWorkspaceId, setCreatedWorkspaceId] = useState<number | null>(null);

    const resetForm = () => {
        setName("");
        setDescription("");
        setIcon("");
        setStep("info");
        setSelectedTemplate(null);
        setCreatedWorkspaceId(null);
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) resetForm();
        onOpenChange(open);
    };

    const handleSubmit = async () => {
        if (step === "info") {
            if (!name.trim()) {
                toast.error("이름을 입력해주세요.");
                return;
            }

            setIsSubmitting(true);
            try {
                const result = await onSubmit({
                    name: name.trim(),
                    description: description.trim() || undefined,
                    icon: icon.trim() || undefined,
                });
                if (result.success && result.data?.id) {
                    setCreatedWorkspaceId(result.data.id);
                    setStep("template");
                } else {
                    toast.error(result.error || "생성에 실패했습니다.");
                }
            } catch {
                toast.error("서버에 연결할 수 없습니다.");
            } finally {
                setIsSubmitting(false);
            }
        } else {
            if (selectedTemplate && createdWorkspaceId) {
                setIsSubmitting(true);
                try {
                    const template = FIELD_TEMPLATES.find((t) => t.id === selectedTemplate);
                    if (template) {
                        const res = await fetch(`/api/workspaces/${createdWorkspaceId}/fields/bulk`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ fields: template.fields }),
                        });
                        const result = await res.json();
                        if (result.success) {
                            toast.success(`워크스페이스가 생성되었습니다. ${result.data.created}개 속성이 추가되었습니다.`);
                        }
                    }
                } catch {
                    /* ignore */
                } finally {
                    setIsSubmitting(false);
                }
            } else {
                toast.success("워크스페이스가 생성되었습니다.");
            }
            resetForm();
            onOpenChange(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className={step === "template" ? "max-w-2xl" : "max-w-md"}>
                <DialogHeader>
                    <DialogTitle>
                        {step === "info" ? "워크스페이스 추가" : "속성 템플릿 선택"}
                    </DialogTitle>
                </DialogHeader>

                {step === "info" ? (
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>
                                이름 <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="워크스페이스 이름"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>설명</Label>
                            <Textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="워크스페이스 설명"
                                rows={3}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label>아이콘</Label>
                            <IconPicker value={icon} onChange={setIcon} />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            속성 템플릿을 선택하면 필요한 속성이 자동으로 추가됩니다.
                            건너뛰기를 클릭하면 빈 상태로 시작합니다.
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            {FIELD_TEMPLATES.map((t) => {
                                const Icon = ICON_MAP[t.icon];
                                return (
                                    <Card
                                        key={t.id}
                                        className={cn(
                                            "cursor-pointer hover:border-primary/50 transition-colors",
                                            selectedTemplate === t.id && "border-primary ring-1 ring-primary"
                                        )}
                                        onClick={() => setSelectedTemplate(t.id)}
                                    >
                                        <CardContent className="p-4">
                                            <div className="flex items-center gap-2">
                                                {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
                                                <span className="font-medium">{t.name}</span>
                                            </div>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {t.description}
                                            </p>
                                            <div className="flex flex-wrap gap-1 mt-3">
                                                {t.fields.map((f) => (
                                                    <Badge key={f.key} variant="outline" className="text-xs">
                                                        {f.label}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                )}

                <DialogFooter>
                    {step === "info" ? (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => handleOpenChange(false)}
                                disabled={isSubmitting}
                            >
                                취소
                            </Button>
                            <Button onClick={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting ? "생성 중..." : "다음"}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    toast.success("워크스페이스가 생성되었습니다.");
                                    resetForm();
                                    onOpenChange(false);
                                }}
                                disabled={isSubmitting}
                            >
                                건너뛰기
                            </Button>
                            <Button onClick={handleSubmit} disabled={isSubmitting}>
                                {isSubmitting ? "적용 중..." : selectedTemplate ? "적용" : "건너뛰기"}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
