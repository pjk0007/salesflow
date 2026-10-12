import { useState } from "react";
import { useEmailTemplateLinks } from "@/hooks/useEmailTemplateLinks";
import { useEmailSend } from "@/hooks/useEmailSend";
import { useSenderProfiles } from "@/hooks/useSenderProfiles";
import { useSignatures } from "@/hooks/useSignatures";
import { useSenderUsage } from "@/components/email/sender-profiles/hooks/useSenderUsage";
import SenderSendHint from "@/components/email/sender-profiles/ui/SenderSendHint";
import { groupNotSent } from "@/components/email/sender-profiles/utils/sendResult";
import type { SendErrorEntry } from "@/components/email/sender-profiles/types";
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
import { Loader2, Send, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
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
    /** 발신 프로필 한도(하루 최대·시간대·정지·간격)에 걸려 보내지 않은 건수 */
    limitedCount?: number;
    /** 보내지 않은 레코드와 이유 (주소 없음·수신거부·한도·NHN 실패), 레코드 코드·이메일. 없으면 빠진다 */
    errors?: SendErrorEntry[];
}

/** 이유마다 처음 보이는 레코드 수. 더 있으면 "모두 보기"로 펼친다 — 1,000건을 한꺼번에 늘어놓지 않으려고 */
const RECIPIENT_PREVIEW = 8;

export default function SendEmailDialog({
    open,
    onOpenChange,
    partitionId,
    recordIds,
}: SendEmailDialogProps) {
    const { templateLinks } = useEmailTemplateLinks(partitionId);
    const { sendEmail } = useEmailSend();
    const { profiles, defaultProfile } = useSenderProfiles();
    const { usageById, mutate: refreshUsage } = useSenderUsage(open);
    const { signatures, defaultSignature } = useSignatures();
    const [selectedLinkId, setSelectedLinkId] = useState<number | null>(null);
    // 사용자가 고른 값. 고르기 전에는 기본 프로필·기본 서명을 쓴다 (effect로 상태를 채우지 않고 그때그때 계산한다)
    const [pickedProfileId, setPickedProfileId] = useState<string>("");
    const [pickedSigId, setPickedSigId] = useState<string>("");
    const selectedProfileId = pickedProfileId || (defaultProfile ? String(defaultProfile.id) : "");
    const selectedSigId = pickedSigId || (defaultSignature ? String(defaultSignature.id) : "");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<EmailSendResult | null>(null);
    // "모두 보기"로 펼친 이유
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

    const activeLinks = templateLinks.filter((l) => l.isActive === 1);

    const handleSend = async () => {
        if (!selectedLinkId) {
            toast.error("템플릿을 선택해주세요.");
            return;
        }
        if (profiles.length > 0 && !selectedProfileId) {
            toast.error("발신자 프로필을 선택해주세요.");
            return;
        }

        setLoading(true);
        const sendResult = await sendEmail({
            templateLinkId: selectedLinkId,
            recordIds,
            senderProfileId: selectedProfileId ? Number(selectedProfileId) : undefined,
            signatureId: selectedSigId === "none" ? null : selectedSigId ? Number(selectedSigId) : undefined,
        });
        setLoading(false);

        if (sendResult.success) {
            const data = sendResult.data as EmailSendResult;
            setResult(data);
            // 방금 보낸 만큼 오늘 사용량이 바뀌었다 — 다음 발송 안내가 옛 숫자를 보이지 않게
            refreshUsage();
            const limited = data.limitedCount ?? 0;
            // 결과 대화상자 제목과 같은 말을 쓴다 — 일부라도 못 보냈으면 "발송 완료"라고 하지 않는다
            const notSent = data.failCount + limited;
            const head = notSent === 0 ? "발송 완료" : data.successCount === 0 ? "보내지 못했습니다" : "일부만 보냈습니다";
            const message = `${head}: 성공 ${data.successCount}건, 실패 ${data.failCount}건${limited > 0 ? `, 발송 제한 ${limited}건` : ""}`;
            if (notSent > 0) toast.warning(message);
            else toast.success(message);
        } else {
            toast.error(sendResult.error || "발송에 실패했습니다.");
        }
    };

    const handleClose = () => {
        setSelectedLinkId(null);
        setPickedProfileId("");
        setPickedSigId("");
        setResult(null);
        setExpanded(new Set());
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>이메일 발송</DialogTitle>
                    <DialogDescription>
                        {recordIds.length}건의 레코드에 이메일을 발송합니다.
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    // 대화상자가 grid라 긴 발신자 이름이 칸을 밀어 넓히지 않게 min-w-0을 준다
                    <div className="min-w-0 space-y-4">
                        <div className="text-center py-4">
                            {/* 한도·주소 없음·수신거부·NHN 실패 무엇이든 못 보낸 레코드가 있으면 "완료"로 보이지 않는다 */}
                            {result.successCount < result.totalCount ? (
                                <>
                                    <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
                                    <p className="text-lg font-medium">
                                        {result.successCount > 0 ? "일부는 보내지 못했습니다" : "보내지 못했습니다"}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                                    <p className="text-lg font-medium">발송 완료</p>
                                </>
                            )}
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
                            {(result.limitedCount ?? 0) > 0 && (
                                <div className="text-center">
                                    <p className="text-2xl font-bold text-amber-600">
                                        {result.limitedCount}
                                    </p>
                                    <p className="text-xs text-muted-foreground">발송 제한</p>
                                </div>
                            )}
                        </div>
                        {(() => {
                            const groups = groupNotSent(result.errors);
                            if (groups.length === 0) return null;
                            const total = groups.reduce((n, g) => n + g.count, 0);
                            return (
                                <div className="max-h-[45vh] space-y-3 overflow-y-auto rounded-lg bg-muted p-3 text-xs">
                                    <p className="font-medium">보내지 않은 레코드 {total.toLocaleString()}건</p>
                                    {groups.map((g) => {
                                        const open = expanded.has(g.message);
                                        const shown = open ? g.recipients : g.recipients.slice(0, RECIPIENT_PREVIEW);
                                        return (
                                            <section key={g.message} className="space-y-1">
                                                <div className="flex justify-between gap-3">
                                                    <p className="break-all text-foreground">{g.message}</p>
                                                    <span className="shrink-0 tabular-nums text-muted-foreground">{g.count.toLocaleString()}건</span>
                                                </div>
                                                <ul className="flex flex-wrap gap-1">
                                                    {shown.map((r) => (
                                                        <li key={r.recordId} className="rounded border bg-background px-1.5 py-0.5 text-muted-foreground break-all">
                                                            {r.label}
                                                        </li>
                                                    ))}
                                                </ul>
                                                {g.recipients.length > RECIPIENT_PREVIEW && (
                                                    <button
                                                        type="button"
                                                        className="text-primary hover:underline"
                                                        onClick={() =>
                                                            setExpanded((prev) => {
                                                                const next = new Set(prev);
                                                                if (open) next.delete(g.message);
                                                                else next.add(g.message);
                                                                return next;
                                                            })
                                                        }
                                                    >
                                                        {open ? "접기" : `외 ${(g.recipients.length - RECIPIENT_PREVIEW).toLocaleString()}건 모두 보기`}
                                                    </button>
                                                )}
                                            </section>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                        <Button className="w-full" onClick={handleClose}>
                            닫기
                        </Button>
                    </div>
                ) : (
                    <div className="min-w-0 space-y-4">
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

                        {/* 발신자 프로필 선택 */}
                        {profiles.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">발신자</p>
                                <Select value={selectedProfileId} onValueChange={setPickedProfileId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="발신자 선택" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {profiles.map((p) => (
                                            <SelectItem key={p.id} value={String(p.id)}>
                                                {p.name} ({p.fromName} &lt;{p.fromEmail}&gt;)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <SenderSendHint
                                    profile={profiles.find((p) => String(p.id) === selectedProfileId)}
                                    usage={selectedProfileId ? usageById.get(Number(selectedProfileId)) : undefined}
                                    recordCount={recordIds.length}
                                />
                            </div>
                        )}

                        {/* 서명 선택 */}
                        {signatures.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">서명</p>
                                <Select value={selectedSigId} onValueChange={setPickedSigId}>
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
