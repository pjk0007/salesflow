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
import { extractEmailVariables } from "@/lib/email-utils";

interface EmailTestSendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    template: {
        id: number;
        subject: string;
        htmlBody: string | null;
    };
}

export default function EmailTestSendDialog({
    open,
    onOpenChange,
    template,
}: EmailTestSendDialogProps) {
    const [recipientEmail, setRecipientEmail] = useState("");
    const [variables, setVariables] = useState<Record<string, string>>({});
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<{
        success: boolean;
        requestId?: string;
        error?: string;
    } | null>(null);

    const variableNames = useMemo(
        () => extractEmailVariables(template.subject + (template.htmlBody || "")),
        [template.subject, template.htmlBody]
    );

    const previewSubject = useMemo(() => {
        let text = template.subject;
        for (const varName of variableNames) {
            text = text.replaceAll(varName, variables[varName] || varName);
        }
        return text;
    }, [template.subject, variableNames, variables]);

    const handleSend = async () => {
        if (!recipientEmail.includes("@")) return;
        setSending(true);
        setResult(null);
        try {
            const res = await fetch("/api/email/test-send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    templateId: template.id,
                    recipientEmail,
                    variables: Object.keys(variables).length > 0 ? variables : undefined,
                }),
            });
            const data = await res.json();
            setResult(data);
        } catch {
            setResult({ success: false, error: "요청에 실패했습니다." });
        } finally {
            setSending(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            setResult(null);
            setSending(false);
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader>
                    <DialogTitle>테스트 발송</DialogTitle>
                </DialogHeader>

                <div className="space-y-4 mt-2">
                    <div className="space-y-2">
                        <Label>수신자 이메일</Label>
                        <Input
                            type="email"
                            placeholder="test@example.com"
                            value={recipientEmail}
                            onChange={(e) => setRecipientEmail(e.target.value)}
                        />
                    </div>

                    {variableNames.length > 0 && (
                        <div className="space-y-2">
                            <Label className="text-muted-foreground text-xs">변수 값 (선택)</Label>
                            {variableNames.map((varName) => (
                                <div key={varName} className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground w-32 truncate shrink-0">
                                        {varName}
                                    </span>
                                    <Input
                                        className="h-8 text-sm"
                                        placeholder="값 입력"
                                        value={variables[varName] || ""}
                                        onChange={(e) =>
                                            setVariables((prev) => ({ ...prev, [varName]: e.target.value }))
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded-md border p-3 bg-muted/50">
                        <p className="text-xs text-muted-foreground mb-1">제목 미리보기</p>
                        <p className="text-sm font-medium">{previewSubject}</p>
                    </div>

                    {result && (
                        <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${
                            result.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                        }`}>
                            {result.success ? (
                                <CheckCircle className="h-4 w-4 shrink-0" />
                            ) : (
                                <XCircle className="h-4 w-4 shrink-0" />
                            )}
                            <span>
                                {result.success
                                    ? `발송 완료 (${result.requestId || ""})`
                                    : result.error || "발송에 실패했습니다."}
                            </span>
                        </div>
                    )}

                    <Button
                        className="w-full"
                        onClick={handleSend}
                        disabled={sending || !recipientEmail.includes("@")}
                    >
                        {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        테스트 발송
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
