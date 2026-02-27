import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";

interface TemplateDetailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    templateCode: string;
    onEdit?: (template: NhnTemplate) => void;
    onDelete?: (templateCode: string) => void;
}

export default function TemplateDetailDialog({
    open,
    onOpenChange,
    senderKey,
    templateCode,
    onEdit,
    onDelete,
}: TemplateDetailDialogProps) {
    const [template, setTemplate] = useState<NhnTemplate | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!open) return;
        setLoading(true);
        fetch(
            `/api/alimtalk/templates/${encodeURIComponent(templateCode)}?senderKey=${encodeURIComponent(senderKey)}`
        )
            .then((r) => r.json())
            .then((result) => {
                if (result.success) setTemplate(result.data);
            })
            .finally(() => setLoading(false));
    }, [open, senderKey, templateCode]);

    // 변수 하이라이트
    const highlightVariables = (content: string) => {
        return content.replace(
            /#\{([^}]+)\}/g,
            '<span class="bg-yellow-200 text-yellow-800 px-1 rounded text-xs font-mono">#{$1}</span>'
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>템플릿 상세</DialogTitle>
                </DialogHeader>

                {loading ? (
                    <div className="space-y-3">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-40 w-full" />
                    </div>
                ) : template ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="font-medium">{template.templateName}</span>
                            <Badge variant="outline" className="text-xs font-mono">
                                {template.templateCode}
                            </Badge>
                        </div>

                        <div className="flex gap-2">
                            <Badge>{template.templateStatusName || template.templateStatus}</Badge>
                            <Badge variant="secondary">{template.templateMessageType}</Badge>
                        </div>

                        {/* 카카오톡 스타일 미리보기 */}
                        <div className="bg-[#B2C7D9] rounded-lg p-4">
                            <div className="bg-white rounded-lg p-3 shadow-sm max-w-[280px]">
                                <div
                                    className="text-sm whitespace-pre-wrap leading-relaxed"
                                    dangerouslySetInnerHTML={{
                                        __html: highlightVariables(template.templateContent),
                                    }}
                                />
                                {template.buttons && template.buttons.length > 0 && (
                                    <div className="mt-3 space-y-1">
                                        {template.buttons.map((btn) => (
                                            <div
                                                key={btn.ordering}
                                                className="text-center text-sm py-2 border rounded bg-gray-50 text-blue-600"
                                            >
                                                {btn.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="text-xs text-muted-foreground space-y-1">
                            <p>등록일: {template.createDate}</p>
                            <p>수정일: {template.updateDate}</p>
                        </div>

                        {(onEdit || onDelete) && (
                            <div className="flex gap-2 pt-2 border-t">
                                {onEdit && ["TSC", "APR", "REJ"].includes(template.templateStatus) && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { onEdit(template); onOpenChange(false); }}
                                    >
                                        수정
                                    </Button>
                                )}
                                {onDelete && ["TSC", "REQ", "REJ"].includes(template.templateStatus) && (
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => { onDelete(template.templateCode); onOpenChange(false); }}
                                    >
                                        삭제
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-muted-foreground">템플릿 정보를 불러올 수 없습니다.</p>
                )}
            </DialogContent>
        </Dialog>
    );
}
