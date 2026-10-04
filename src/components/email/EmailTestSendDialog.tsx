import {
    Dialog,
    DialogContent,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useEmailTestSend } from "./hooks/useEmailTestSend";

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
    const {
        profiles,
        signatures,
        recipientEmail,
        setRecipientEmail,
        variables,
        variableNames,
        setVariable,
        selectedProfileId,
        setSelectedProfileId,
        selectedSigId,
        setSelectedSigId,
        previewSubject,
        sending,
        result,
        handleSend,
        reset,
    } = useEmailTestSend(template);

    const handleOpenChange = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
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

                    {profiles.length > 0 && (
                        <div className="space-y-2">
                            <Label>발신 프로필</Label>
                            <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="발신 프로필 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    {profiles.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                            {p.fromName} &lt;{p.fromEmail}&gt;
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {signatures.length > 0 && (
                        <div className="space-y-2">
                            <Label>서명</Label>
                            <Select value={selectedSigId} onValueChange={setSelectedSigId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="서명 선택" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">서명 없음</SelectItem>
                                    {signatures.map((s) => (
                                        <SelectItem key={s.id} value={String(s.id)}>
                                            {s.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

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
                                        onChange={(e) => setVariable(varName, e.target.value)}
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
