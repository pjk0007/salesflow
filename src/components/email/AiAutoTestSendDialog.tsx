"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

interface AiAutoTestSendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    linkId: number;
    linkName: string;
    recipientField: string;
    companyField: string;
}

export default function AiAutoTestSendDialog({
    open,
    onOpenChange,
    linkId,
    linkName,
    recipientField,
    companyField,
}: AiAutoTestSendDialogProps) {
    const [testEmail, setTestEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [contactName, setContactName] = useState("");
    const [sending, setSending] = useState(false);
    const [preview, setPreview] = useState<{ subject: string; htmlBody: string } | null>(null);

    const handleSend = async () => {
        if (!testEmail || !testEmail.includes("@")) {
            toast.error("유효한 이메일 주소를 입력해주세요.");
            return;
        }
        if (!companyName.trim()) {
            toast.error("회사명을 입력해주세요.");
            return;
        }

        setSending(true);
        setPreview(null);

        try {
            const testData: Record<string, string> = {
                [recipientField]: testEmail,
                [companyField]: companyName,
            };
            if (contactName.trim()) {
                testData["이름"] = contactName;
                testData["대표자"] = contactName;
            }

            const res = await fetch("/api/email/auto-personalized/test-send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linkId, testEmail, testData }),
            });
            const result = await res.json();

            if (result.success) {
                toast.success(`테스트 이메일이 ${testEmail}로 발송되었습니다.`);
                setPreview({ subject: result.data.subject, htmlBody: result.data.htmlBody });
            } else {
                toast.error(result.error || "테스트 발송에 실패했습니다.");
            }
        } catch {
            toast.error("테스트 발송 중 오류가 발생했습니다.");
        } finally {
            setSending(false);
        }
    };

    const handleClose = (open: boolean) => {
        if (!open) {
            setPreview(null);
            setTestEmail("");
            setCompanyName("");
            setContactName("");
        }
        onOpenChange(open);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>AI 자동발송 테스트</DialogTitle>
                    <DialogDescription>
                        &quot;{linkName}&quot; 규칙으로 AI 이메일을 생성하여 테스트 발송합니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="test-email">수신 이메일</Label>
                        <Input
                            id="test-email"
                            type="email"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            placeholder="test@example.com"
                            disabled={sending}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="test-company">회사명</Label>
                        <Input
                            id="test-company"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            placeholder="예: 삼성전자"
                            disabled={sending}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="test-name">담당자명 (선택)</Label>
                        <Input
                            id="test-name"
                            value={contactName}
                            onChange={(e) => setContactName(e.target.value)}
                            placeholder="예: 홍길동"
                            disabled={sending}
                        />
                    </div>

                    {preview && (
                        <div className="space-y-2">
                            <Label>생성된 이메일 미리보기</Label>
                            <div className="rounded-md border p-3 space-y-2">
                                <p className="text-sm font-medium">제목: {preview.subject}</p>
                                <div className="border-t pt-2">
                                    <iframe
                                        srcDoc={preview.htmlBody}
                                        className="w-full min-h-[300px] border-0"
                                        sandbox=""
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleClose(false)} disabled={sending}>
                        닫기
                    </Button>
                    {!preview && (
                        <Button onClick={handleSend} disabled={sending || !testEmail || !companyName.trim()}>
                            {sending ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Send className="h-4 w-4 mr-2" />
                            )}
                            {sending ? "생성 및 발송 중..." : "테스트 발송"}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
