import { useState } from "react";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { useEmailSend } from "@/hooks/useEmailSend";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface SendEmailDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    recordIds: number[];
}

interface EmailSendResult {
    totalCount: number;
    successCount: number;
    failCount: number;
}

export default function SendEmailDialog({
    open,
    onOpenChange,
    partitionId,
    recordIds,
}: SendEmailDialogProps) {
    const { templateLinks } = useEmailTemplateLinks(partitionId);
    const { sendEmail } = useEmailSend();
    const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<EmailSendResult | null>(null);

    const activeLinks = templateLinks.filter((l) => l.isActive === 1);

    const handleSend = async () => {
        if (!selectedLinkId) {
            toast.error("템플릿을 선택해주세요.");
            return;
        }

        setLoading(true);
        const sendResult = await sendEmail({
            templateLinkId: selectedLinkId,
            recordIds,
        });
        setLoading(false);

        if (sendResult.success) {
            setResult(sendResult.data);
            toast.success(
                `발송 완료: 성공 ${sendResult.data.successCount}건, 실패 ${sendResult.data.failCount}건`
            );
        } else {
            toast.error(sendResult.error || "발송에 실패했습니다.");
        }
    };

    const handleClose = () => {
        setSelectedLinkId(null);
        setResult(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>이메일 발송</DialogTitle>
                    <DialogDescription>
                        {recordIds.length}건의 레코드에 이메일을 발송합니다.
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <div className="space-y-4">
                        <div className="text-center py-4">
                            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                            <p className="text-lg font-medium">발송 완료</p>
                        </div>
                        <div className="flex justify-center gap-4">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-green-600">
                                    {result.successCount}
                                </p>
                                <p className="text-xs text-muted-foreground">성공</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-red-600">
                                    {result.failCount}
                                </p>
                                <p className="text-xs text-muted-foreground">실패</p>
                            </div>
                        </div>
                        <Button className="w-full" onClick={handleClose}>
                            닫기
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <p className="text-sm font-medium">템플릿 선택</p>
                            {activeLinks.length === 0 ? (
                                <div className="p-4 border rounded-lg border-dashed text-center text-sm text-muted-foreground">
                                    <p>연결된 템플릿이 없습니다.</p>
                                    <p>템플릿 탭에서 먼저 연결해주세요.</p>
                                </div>
                            ) : (
                                <Select
                                    value={selectedLinkId ? String(selectedLinkId) : ""}
                                    onValueChange={(v) => setSelectedLinkId(Number(v))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="발송할 템플릿 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {activeLinks.map((link) => (
                                            <SelectItem key={link.id} value={String(link.id)}>
                                                {link.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {selectedLinkId && (
                            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                                {(() => {
                                    const link = activeLinks.find((l) => l.id === selectedLinkId);
                                    if (!link) return null;
                                    return (
                                        <>
                                            <p>
                                                <span className="text-muted-foreground">수신이메일 필드:</span>{" "}
                                                {link.recipientField}
                                            </p>
                                            {link.variableMappings && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {Object.keys(
                                                        link.variableMappings as Record<string, string>
                                                    ).map((v) => (
                                                        <Badge key={v} variant="outline" className="text-xs">
                                                            {v}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <XCircle className="h-4 w-4 text-yellow-600 shrink-0" />
                            <p className="text-xs text-yellow-700">
                                이메일 주소가 없거나 형식이 맞지 않는 레코드는 자동으로 제외됩니다.
                            </p>
                        </div>

                        <Button
                            className="w-full"
                            onClick={handleSend}
                            disabled={loading || !selectedLinkId}
                        >
                            {loading ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4 mr-2" />
                            )}
                            {recordIds.length}건 발송
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
