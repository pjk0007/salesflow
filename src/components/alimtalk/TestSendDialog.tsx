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
import { AlertTriangle, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { extractTemplateParameterKeys } from "@/lib/alimtalk-template-utils";
import { apiRequest, RequestError, requestErrorMessage } from "@/lib/swr-fetcher";
import type { NhnTemplate } from "@/lib/nhn-alimtalk";

interface TestSendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 본문뿐 아니라 버튼·강조·헤더·아이템의 변수까지 입력받기 위해 템플릿 전체를 받는다. */
    template: NhnTemplate;
}

export default function TestSendDialog({
    open,
    onOpenChange,
    template,
}: TestSendDialogProps) {
    const { senderKey, templateCode } = template;
    const templateContent = template.templateContent ?? "";
    const [recipientNo, setRecipientNo] = useState("");
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{
        status: "pending" | "failed" | "unknown";
        requestId?: string;
        error?: string;
    } | null>(null);

    const variableNames = useMemo(() => extractTemplateParameterKeys(template), [template]);

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

            const data = await apiRequest<{ data?: { status?: "pending" | "unknown"; requestId?: string } }>("/api/alimtalk/test-send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    senderKey,
                    templateCode,
                    recipientNo,
                    templateParameter,
                }),
            });
            setResult({ status: data.data?.status === "pending" ? "pending" : "unknown", requestId: data.data?.requestId });
        } catch (error) {
            // 연결이 끊기거나 지연되면 요청이 이미 나갔을 수 있다 — 실패로 단정하지 않는다.
            if (error instanceof RequestError && (error.status === 0 || error.status === 408 || error.status >= 500)) {
                setResult({ status: "unknown" });
            } else {
                setResult({ status: "failed", error: requestErrorMessage(error, "발송 요청을 처리하지 못했습니다.") });
            }
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
                        {result.status === "pending" ? (
                            <>
                                <CheckCircle className="h-10 w-10 text-green-500" />
                                <p className="font-medium">발송 접수됨</p>
                                <p className="text-sm text-muted-foreground text-center">
                                    공급자가 요청을 접수했습니다. 실제 수신 여부는 카카오톡 처리 후 확정됩니다.
                                </p>
                                {result.requestId && (
                                    <p className="text-sm text-muted-foreground">
                                        요청 ID: {result.requestId}
                                    </p>
                                )}
                            </>
                        ) : result.status === "unknown" ? (
                            <>
                                <AlertTriangle className="h-10 w-10 text-yellow-500" />
                                <p className="font-medium">접수 결과 확인 필요</p>
                                <p className="text-sm text-muted-foreground text-center">
                                    요청이 이미 전달됐을 수 있습니다. 같은 번호로 다시 보내기 전에 휴대폰 수신 여부를 확인해주세요.
                                </p>
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
