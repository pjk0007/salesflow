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
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
                            <Badge>{template.statusName || template.status}</Badge>
                            <Badge variant="secondary">{template.templateMessageType}</Badge>
                        </div>

                        {/* 카카오톡 스타일 미리보기 */}
                        <div className="bg-[#B2C7D9] rounded-lg p-4">
                            <div className="bg-white rounded-lg shadow-sm max-w-[280px] overflow-hidden">
                                {/* 이미지 강조 */}
                                {template.templateEmphasizeType === "IMAGE" && template.templateImageUrl && (
                                    <img
                                        src={template.templateImageUrl}
                                        alt="강조 이미지"
                                        className="w-full aspect-[2/1] object-cover"
                                    />
                                )}

                                <div className="p-3">
                                    {/* 강조 텍스트 */}
                                    {template.templateEmphasizeType === "TEXT" && (
                                        <div className="mb-2">
                                            {template.templateTitle && (
                                                <p className="text-base font-bold leading-tight">{template.templateTitle}</p>
                                            )}
                                            {template.templateSubtitle && (
                                                <p className="text-xs text-muted-foreground">{template.templateSubtitle}</p>
                                            )}
                                        </div>
                                    )}

                                    {/* 헤더 */}
                                    {template.templateHeader && (
                                        <p className="text-xs text-muted-foreground mb-1">{template.templateHeader}</p>
                                    )}

                                    {/* 아이템 하이라이트 */}
                                    {template.templateEmphasizeType === "ITEM_LIST" && template.templateItemHighlight && (
                                        <div className="flex items-center gap-2 mb-2 p-2 bg-gray-50 rounded">
                                            {template.templateItemHighlight.imageUrl && (
                                                <img src={template.templateItemHighlight.imageUrl} alt="" className="w-10 h-10 rounded object-cover" />
                                            )}
                                            <div>
                                                <p className="text-sm font-bold">{template.templateItemHighlight.title}</p>
                                                <p className="text-xs text-muted-foreground">{template.templateItemHighlight.description}</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* 아이템 리스트 */}
                                    {template.templateItem?.list && template.templateItem.list.length > 0 && (
                                        <div className="mb-2 text-xs space-y-1 border-t border-b py-1">
                                            {template.templateItem.list.map((item, i) => (
                                                <div key={i} className="flex justify-between">
                                                    <span className="text-muted-foreground">{item.title}</span>
                                                    <span>{item.description}</span>
                                                </div>
                                            ))}
                                            {template.templateItem.summary && (
                                                <div className="flex justify-between font-bold pt-1 border-t">
                                                    <span>{template.templateItem.summary.title}</span>
                                                    <span>{template.templateItem.summary.description}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* 본문 */}
                                    <div
                                        className="text-sm whitespace-pre-wrap leading-relaxed"
                                        dangerouslySetInnerHTML={{
                                            __html: highlightVariables(template.templateContent),
                                        }}
                                    />

                                    {/* 부가정보 */}
                                    {template.templateExtra && (
                                        <div className="mt-2 pt-2 border-t text-xs text-muted-foreground whitespace-pre-wrap">
                                            {template.templateExtra}
                                        </div>
                                    )}

                                    {/* 버튼 */}
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

                                    {/* 빠른 응답 */}
                                    {template.quickReplies && template.quickReplies.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-1">
                                            {template.quickReplies.map((qr, i) => (
                                                <span key={i} className="text-xs px-2 py-1 border rounded-full text-blue-600">
                                                    {qr.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="text-xs text-muted-foreground space-y-1">
                            <p>등록일: {template.createDate}</p>
                            <p>수정일: {template.updateDate}</p>
                        </div>

                        {(onEdit || onDelete) && (
                            <div className="flex gap-2 pt-2 border-t">
                                {onEdit && ["TSC01", "TSC03", "TSC04"].includes(template.status) && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => { onEdit(template); onOpenChange(false); }}
                                    >
                                        수정
                                    </Button>
                                )}
                                {onDelete && ["TSC01", "TSC02", "TSC04"].includes(template.status) && (
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
