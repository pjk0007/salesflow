import { useRef, useState } from "react";
import { useAlimtalkTemplateLinks } from "@/hooks/useAlimtalkTemplateLinks";
import { useAlimtalkSend } from "@/hooks/useAlimtalkSend";
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

interface SendAlimtalkDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    partitionId: number;
    recordIds: number[];
    /** 결과의 레코드별 제외·실패 사유에서 그 레코드 상세를 연다(UX-181) */
    onEditRecord?: (recordId: number) => void;
}

interface SendResult {
    requestId: string;
    totalCount: number;
    successCount: number;
    failCount: number;
    unknownCount?: number;
    excludedCount?: number;
    warning?: string;
    errors?: Array<{ recordId?: number; error: string }>;
}

export default function SendAlimtalkDialog({
    open,
    onOpenChange,
    partitionId,
    recordIds,
    onEditRecord,
}: SendAlimtalkDialogProps) {
    const { templateLinks } = useAlimtalkTemplateLinks(partitionId);
    const { sendAlimtalk } = useAlimtalkSend();
    const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<SendResult | null>(null);
    const sending = useRef(false);

    const activeLinks = templateLinks.filter((l) => l.isActive === 1);

    const handleSend = async () => {
        if (sending.current) return;
        if (!selectedLinkId) {
            toast.error("템플릿을 선택해주세요.");
            return;
        }

        sending.current = true;
        setLoading(true);
        try {
        const sendResult = await sendAlimtalk({
            templateLinkId: selectedLinkId,
            recordIds,
        });
        if (sendResult.success) {
            setResult(sendResult.data);
            if (sendResult.data.warning) toast.warning(sendResult.data.warning);
            else toast.success(`접수 ${sendResult.data.successCount}건, 실패 ${sendResult.data.failCount}건`);
        } else {
            toast.error(sendResult.error || "발송에 실패했습니다.");
            if (sendResult.data?.errors?.length) setResult({ requestId: "", totalCount: recordIds.length,
                successCount: 0, failCount: 0, excludedCount: recordIds.length, errors: sendResult.data.errors });
        }
        } catch {
            setResult({ requestId: "", totalCount: recordIds.length, successCount: 0, failCount: 0,
                unknownCount: recordIds.length, warning: "응답을 확인할 수 없습니다. 다시 발송하지 말고 발송 이력에서 접수 여부를 확인해주세요." });
            toast.warning("발송 결과 확인이 필요합니다. 중복 발송 전에 이력을 확인해주세요.");
        } finally { sending.current = false; setLoading(false); }
    };

    const handleClose = () => {
        if (sending.current) return;
        setSelectedLinkId(null);
        setResult(null);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>알림톡 발송</DialogTitle>
                    <DialogDescription>
                        {recordIds.length}건의 레코드에 알림톡을 발송합니다.
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <div className="space-y-4">
                        <div className="text-center py-4">
                            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                            <p className="text-lg font-medium">발송 요청 결과</p>
                        </div>
                        <div className="flex justify-center gap-4">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-green-600">
                                    {result.successCount}
                                </p>
                                <p className="text-xs text-muted-foreground">접수됨</p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-red-600">
                                    {result.failCount}
                                </p>
                                <p className="text-xs text-muted-foreground">실패</p>
                            </div>
                        </div>
                        <p className="text-sm">제외 {result.excludedCount ?? 0}건 · 확인 필요 {result.unknownCount ?? 0}건</p>
                        {result.warning && <p role="alert" className="text-sm text-amber-700">{result.warning}</p>}
                        {result.errors?.length ? <ul className="max-h-40 overflow-y-auto text-sm space-y-1">{result.errors.map((error, index) => {
                            const recordId = error.recordId;
                            return <li key={index}>{recordId && onEditRecord ? <><button type="button" className="underline"
                                aria-label={`레코드 #${recordId} 상세 열기`}
                                onClick={() => { handleClose(); onEditRecord(recordId); }}>레코드 #{recordId}</button>: </>
                                : recordId ? `레코드 #${recordId}: ` : ""}{error.error}</li>;
                        })}</ul> : null}
                        <p className="text-xs text-center text-muted-foreground">
                            {result.requestId ? `요청 ID: ${result.requestId}` : "요청 ID 미확인"} · 최종 수신 결과는 발송 이력에서 확인해주세요.
                        </p>
                        <a className="block text-center text-sm underline" href="/alimtalk?tab=logs">발송 이력 확인</a>
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
                                                {link.name} ({link.templateCode})
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
                                                <span className="text-muted-foreground">수신번호 필드:</span>{" "}
                                                {link.recipientField}
                                            </p>
                                            <p>
                                                <span className="text-muted-foreground">발신프로필:</span>{" "}
                                                <span className="font-mono text-xs">{link.senderKey}</span>
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
                                수신번호가 없거나 형식이 맞지 않는 레코드는 자동으로 제외됩니다.
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
