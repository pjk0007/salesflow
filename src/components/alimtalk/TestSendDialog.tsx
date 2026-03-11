import { useState, useMemo } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

interface TestSendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    senderKey: string;
    templateCode: string;
    templateContent: string;
}

function extractVariableNames(content: string): string[] {
    const matches = content.match(/#\{([^}]+)\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.slice(2, -1)))];
}

export default function TestSendDialog({
    open,
    onOpenChange,
    senderKey,
    templateCode,
    templateContent,
}: TestSendDialogProps) {
    const [recipientNo, setRecipientNo] = useState("");
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{
        success: boolean;
        requestId?: string;
        error?: string;
    } | null>(null);

    const variableNames = useMemo(() => extractVariableNames(templateContent), [templateContent]);

    const preview = useMemo(() => {
        let text = templateContent;
        for (const name of variableNames) {
            text = text.replaceAll(`#{${name}}`, variables[name] || `#{${name}}`);
        }
        return text;
    }, [templateContent, variableNames, variables]);

    const handleSend = async () => {
        setSending(true);
        setResult(null);
        try {
            const templateParameter: Record<string, string> | undefined =
                variableNames.length > 0
                    ? Object.fromEntries(variableNames.map((n) => [n, variables[n] || ""]))
                    : undefined;

            const res = await fetch("/api/alimtalk/test-send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    senderKey,
                    templateCode,
                    recipientNo,
                    templateParameter,
                }),
            });
            const data = await res.json();
            setResult({
                success: data.success,
                requestId: data.data?.requestId,
                error: data.error,
            });
        } catch {
            setResult({ success: false, error: "요청 중 오류가 발생했습니다." });
        } finally {
            setSending(false);
        }
    };

    const handleClose = (v: boolean) => {
        if (!v) {
            setRecipientNo("");
            setVariables({});
            setResult(null);
        }
        onOpenChange(v);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>테스트 발송</DialogTitle>
                </DialogHeader>

                {result ? (
                    <div className="flex flex-col items-center gap-3 py-4">
                        {result.success ? (
                            <>
                                <CheckCircle className="h-10 w-10 text-green-500" />
                                <p className="font-medium">발송 성공</p>
                                {result.requestId && (
                                    <p className="text-sm text-muted-foreground">
                                        요청 ID: {result.requestId}
                                    </p>
                                )}
                            </>
                        ) : (
                            <>
                                <XCircle className="h-10 w-10 text-destructive" />
                                <p className="font-medium">발송 실패</p>
                                {result.error && (
                                    <p className="text-sm text-destructive">{result.error}</p>
                                )}
                            </>
                        )}
                        <Button onClick={() => handleClose(false)} className="mt-2">
                            확인
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>수신번호</Label>
                            <Input
                                placeholder="01012345678"
                                value={recipientNo}
                                onChange={(e) => setRecipientNo(e.target.value)}
                            />
                        </div>

                        {variableNames.length > 0 && (
                            <div className="space-y-2">
                                <Label className="text-muted-foreground">변수 입력</Label>
                                {variableNames.map((name) => (
                                    <div key={name} className="flex items-center gap-2">
                                        <span className="text-sm font-mono min-w-[100px] text-right text-muted-foreground">
                                            {"#{" + name + "}"}
                                        </span>
                                        <Input
                                            placeholder={name}
                                            value={variables[name] || ""}
                                            onChange={(e) =>
                                                setVariables((prev) => ({
                                                    ...prev,
                                                    [name]: e.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label className="text-muted-foreground">미리보기</Label>
                            <div className="rounded-md border bg-muted/50 p-3 text-sm whitespace-pre-wrap">
                                {preview}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
                                취소
                            </Button>
                            <Button onClick={handleSend} disabled={sending || !recipientNo.trim()}>
                                {sending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                        발송 중...
                                    </>
                                ) : (
                                    "발송"
                                )}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
