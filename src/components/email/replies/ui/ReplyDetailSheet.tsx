"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { ReplyItem, ReplyKind, ReplyPatch } from "../types";
import { useReplies } from "../hooks/useReplies";
import {
    KIND_OPTIONS,
    MATCH_LABELS,
    bounceTypeLabel,
    effectsText,
    formatKstDateTime,
    matchMethodLabel,
    ruleStepText,
} from "../utils/labels";
import { ReplyKindBadge } from "./ReplyKindBadge";

const ALERT_STATUS_LABELS: Record<string, string> = {
    pending: "보낼 차례",
    processing: "보내는 중",
    sent: "보냄",
    failed: "실패",
    skipped: "보내지 않음",
    dry_run: "미리보기 (보내지 않음)",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[96px_1fr] gap-2 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <div className="min-w-0 break-words">{children}</div>
        </div>
    );
}

/**
 * 회신 옆 창 (DESIGN-RPL 11절 1번): 발췌·이어진 발송·레코드·효과(멈춘 수 / 멈출 예정)·카드 미리보기,
 * 버튼 [처리함] [분류 고치기] [자동 메일 다시 허용]. 애매함 줄은 후보 발송을 보여 준다 (관리자, 손으로 잇기는 다음 판)
 */
export function ReplyDetailSheet({
    reply,
    isAdmin,
    onClose,
    onUpdate,
}: {
    reply: ReplyItem | null;
    isAdmin: boolean;
    onClose: () => void;
    onUpdate: (id: number, body: ReplyPatch) => Promise<{ success: boolean; error?: string }>;
}) {
    const [busy, setBusy] = useState(false);
    const [nextKind, setNextKind] = useState<string>("");
    const ambiguous = reply?.matchStatus === "ambiguous";
    const { candidates } = useReplies({ id: reply?.id }, !!reply && ambiguous && isAdmin);

    const run = async (body: ReplyPatch, ok: string) => {
        if (!reply) return;
        setBusy(true);
        const res = await onUpdate(reply.id, body);
        setBusy(false);
        if (res.success) toast.success(ok);
        else toast.error(res.error || "바꾸지 못했습니다.");
    };

    return (
        <Sheet open={!!reply} onOpenChange={(open) => !open && onClose()}>
            <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
                {reply && (
                    <>
                        <SheetHeader>
                            <SheetTitle className="flex flex-wrap items-center gap-2 pr-6">
                                <ReplyKindBadge kind={reply.kind} />
                                <span className="truncate">{reply.fromName || reply.fromEmail}</span>
                            </SheetTitle>
                            <SheetDescription>
                                {reply.fromEmail} → {reply.toEmail} · {formatKstDateTime(reply.receivedAt)} 도착
                            </SheetDescription>
                        </SheetHeader>

                        <div className="space-y-4 px-4 pb-6">
                            <div className="space-y-1">
                                <p className="text-sm font-medium">{reply.subject || "(제목 없음)"}</p>
                                {reply.excerpt ? (
                                    <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-sm">{reply.excerpt}</p>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        {reply.kind === "bounce" || reply.kind === "system"
                                            ? "반송·시스템 안내는 발췌를 남기지 않습니다 (우리 원래 메일의 사본이라)"
                                            : "발췌 없음 — 원문은 회신 메일함에 있습니다"}
                                    </p>
                                )}
                                {reply.unsubscribeHint && (
                                    <p className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-300">
                                        <AlertTriangle className="size-4" /> 수신거부 요청으로 보입니다 — 확인 뒤 수신거부에 넣어 주세요
                                    </p>
                                )}
                                {reply.processError && (
                                    <p className="text-xs text-red-600">저장 중 오류로 최소 정보만 남았습니다 ({reply.processError})</p>
                                )}
                            </div>

                            <Separator />

                            <div className="space-y-2">
                                <Row label="상태">
                                    {MATCH_LABELS[reply.matchStatus] ?? reply.matchStatus}
                                    {reply.matchMethod && <span className="text-muted-foreground"> · {matchMethodLabel(reply.matchMethod)}</span>}
                                </Row>
                                <Row label="사업">
                                    {reply.workspaceName ?? "—"}
                                    {reply.workspaceGuessed && <span className="text-muted-foreground"> (받은 주소로 추정)</span>}
                                </Row>
                                <Row label="규칙·단계">{ruleStepText(reply)}</Row>
                                {reply.contactEmail !== reply.fromEmail && <Row label="연락 주소">{reply.contactEmail}</Row>}
                                {reply.matchedRecipient && reply.matchedRecipient !== reply.contactEmail && (
                                    <Row label="원래 받은 사람">{reply.matchedRecipient}</Row>
                                )}
                                {reply.sendLog && (
                                    <Row label="이어진 발송">
                                        <div className="space-y-0.5">
                                            <p className="truncate">{reply.sendLog.subject || "(제목 없음)"}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {formatKstDateTime(reply.sendLog.sentAt)} · {reply.sendLog.senderEmail ?? "보낸 주소 기록 없음"} →{" "}
                                                {reply.sendLog.recipientEmail}
                                                {reply.sendLog.partitionName ? ` · ${reply.sendLog.partitionName}` : ""}
                                            </p>
                                        </div>
                                    </Row>
                                )}
                                {reply.recordId !== null && (
                                    <Row label="레코드">
                                        <div className="flex flex-wrap gap-3">
                                            <Link className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" href={`/records?id=${reply.recordId}`}>
                                                {reply.integratedCode ?? `#${reply.recordId}`} <ExternalLink className="size-3" />
                                            </Link>
                                            <Link className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" href={`/records/${reply.recordId}/journey`}>
                                                고객 여정 <ExternalLink className="size-3" />
                                            </Link>
                                        </div>
                                    </Row>
                                )}
                                {reply.kind === "bounce" && (
                                    <Row label="반송">
                                        {bounceTypeLabel(reply.bounceType)}
                                        {reply.dsnStatus && <span className="text-muted-foreground"> · {reply.dsnStatus}</span>}
                                        {reply.dsnDiagnostic && <p className="text-xs text-muted-foreground">{reply.dsnDiagnostic}</p>}
                                    </Row>
                                )}
                                <Row label="자동 메일">
                                    {effectsText(reply)}
                                    {!reply.stopAutomation && <p className="text-xs text-muted-foreground">다시 허용됨 — 보내기 직전 막기에서 빠졌습니다</p>}
                                </Row>
                                {reply.alertStatus && (
                                    <Row label="알림 카드">
                                        {ALERT_STATUS_LABELS[reply.alertStatus] ?? reply.alertStatus}
                                        {reply.alertLastError && <span className="text-muted-foreground"> · {reply.alertLastError}</span>}
                                    </Row>
                                )}
                                {reply.handledAt && (
                                    <Row label="처리">
                                        <span className="inline-flex items-center gap-1">
                                            <CheckCircle2 className="size-3.5 text-emerald-600" /> {formatKstDateTime(reply.handledAt)}
                                        </span>
                                    </Row>
                                )}
                            </div>

                            {reply.alertMessage && (
                                <div className="space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground">
                                        {reply.alertStatus === "dry_run" ? "나갈 카드 (미리보기)" : "카드 글자"}
                                    </p>
                                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{reply.alertMessage}</pre>
                                </div>
                            )}

                            {ambiguous && isAdmin && (
                                <div className="space-y-2">
                                    <p className="text-xs font-medium text-muted-foreground">
                                        후보 발송 — 같은 주소로 여러 사업이 보냈습니다. 필요하면 후속 큐에서 손으로 멈춰 주세요
                                    </p>
                                    {candidates.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">후보를 찾지 못했습니다</p>
                                    ) : (
                                        <ul className="space-y-1 text-xs">
                                            {candidates.map((c) => (
                                                <li key={c.sendLogId} className="rounded border px-2 py-1">
                                                    <span className="font-medium">{c.workspaceName ?? "사업 없음"}</span>
                                                    {c.ruleName ? ` · ${c.ruleName}` : ""} · {formatKstDateTime(c.sentAt)}
                                                    <p className="truncate text-muted-foreground">{c.subject ?? "(제목 없음)"}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}

                            <Separator />

                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    size="sm"
                                    variant={reply.handledAt ? "outline" : "default"}
                                    disabled={busy}
                                    onClick={() => run({ handled: !reply.handledAt }, reply.handledAt ? "처리 표시를 지웠습니다" : "처리함으로 표시했습니다")}
                                >
                                    {reply.handledAt ? "처리 취소" : "처리함"}
                                </Button>
                                <div className="flex items-center gap-1">
                                    <Select value={nextKind} onValueChange={setNextKind}>
                                        <SelectTrigger className="h-8 w-[140px]">
                                            <SelectValue placeholder="분류 고치기" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {KIND_OPTIONS.filter((o) => o.value !== reply.kind).map((o) => (
                                                <SelectItem key={o.value} value={o.value}>
                                                    {o.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy || !nextKind}
                                        onClick={async () => {
                                            await run({ kind: nextKind as ReplyKind }, "분류를 고쳤습니다");
                                            setNextKind("");
                                        }}
                                    >
                                        고치기
                                    </Button>
                                </div>
                                {reply.kind === "human" && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() =>
                                            run(
                                                { stopAutomation: !reply.stopAutomation },
                                                reply.stopAutomation ? "앞으로 이 주소에 자동 메일을 다시 보냅니다" : "이 주소의 자동 메일을 다시 막습니다"
                                            )
                                        }
                                    >
                                        {reply.stopAutomation ? "자동 메일 다시 허용" : "자동 메일 다시 막기"}
                                    </Button>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                답장은 메일함에서 사람이 보냅니다. 사람 회신으로 고치면 그 사업의 대기 중인 자동 메일이 멈춥니다. 멈춘 메일은 다시 허용해도 살아나지 않습니다.
                            </p>
                            {reply.kindChangedAt && (
                                <Badge variant="outline" className="text-xs">
                                    분류 고침 · {formatKstDateTime(reply.kindChangedAt)}
                                </Badge>
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}
