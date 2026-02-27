import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, UserRound, Home, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_TEMPLATES } from "@/lib/field-templates";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Building2,
    UserRound,
    Home,
    Users,
};

interface TemplatePickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelect: (templateId: string) => void;
    isApplying: boolean;
}

export default function TemplatePickerDialog({
    open,
    onOpenChange,
    onSelect,
    isApplying,
}: TemplatePickerDialogProps) {
    const [selectedId, setSelectedId] = useState<string | null>(null);

    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                if (!o) setSelectedId(null);
                onOpenChange(o);
            }}
        >
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>속성 템플릿 선택</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                    세일즈 업무에 맞는 템플릿을 선택하면 필요한 속성이 자동으로 추가됩니다.
                </p>
                <div className="grid grid-cols-2 gap-3">
                    {FIELD_TEMPLATES.map((t) => {
                        const Icon = ICON_MAP[t.icon];
                        return (
                            <Card
                                key={t.id}
                                className={cn(
                                    "cursor-pointer hover:border-primary/50 transition-colors",
                                    selectedId === t.id && "border-primary ring-1 ring-primary"
                                )}
                                onClick={() => setSelectedId(t.id)}
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
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={isApplying}
                    >
                        취소
                    </Button>
                    <Button
                        onClick={() => selectedId && onSelect(selectedId)}
                        disabled={!selectedId || isApplying}
                    >
                        {isApplying ? "적용 중..." : "적용"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
