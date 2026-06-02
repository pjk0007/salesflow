"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { defaultFetcher } from "@/lib/swr-fetcher";
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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Eye, Send, Search, Check, MailOpen, Mail } from "lucide-react";
import { toast } from "sonner";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    linkId: number;
    linkName: string;
}

interface LogItem {
    id: number;
    subject: string | null;
    recipientEmail: string;
    sentAt: string;
    recordId: number | null;
    isClicked: boolean;
    identifier: string | null;
}

interface FollowupStep {
    delayDays: number;
    onClicked?: { prompt: string };
    onNotClicked?: { prompt: string };
}

interface LinkInfo {
    id: number;
    name: string | null;
    followupConfig: FollowupStep | FollowupStep[] | null;
}

function normalizeSteps(cfg: LinkInfo["followupConfig"]): FollowupStep[] {
    if (!cfg) return [];
    return Array.isArray(cfg) ? cfg : [cfg];
}

export default function AiFollowupTestDialog({ open, onOpenChange, linkId, linkName }: Props) {
    const { data, isLoading } = useSWR<{
        success: boolean;
        data?: { link: LinkInfo; logs: LogItem[] };
        error?: string;
    }>(open ? `/api/email/auto-personalized/test-followup?linkId=${linkId}` : null, defaultFetcher);

    const link = data?.data?.link;
    const logs = data?.data?.logs ?? [];
    const steps = normalizeSteps(link?.followupConfig ?? null);

    const [parentLogId, setParentLogId] = useState<number | null>(null);
    const [stepIndex, setStepIndex] = useState<number>(0);
    const [isClicked, setIsClicked] = useState(false);
    const [testEmail, setTestEmail] = useState("");
    const [working, setWorking] = useState(false);
    const [logSearch, setLogSearch] = useState("");
    const [preview, setPreview] = useState<{
        subject: string;
        htmlBody: string;
        recordData: Record<string, unknown> | null;
    } | null>(null);

    // 기본 선택: 가장 최근 로그, 1단계, 미클릭 분기
    useEffect(() => {
        if (logs.length > 0 && parentLogId === null) {
            setParentLogId(logs[0].id);
        }
    }, [logs, parentLogId]);

    const filteredLogs = useMemo(() => {
        const q = logSearch.trim().toLowerCase();
        if (!q) return logs;
        return logs.filter((log) =>
            [log.identifier, log.recipientEmail, log.subject]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q)),
        );
    }, [logs, logSearch]);

    const selectedLog = logs.find((l) => l.id === parentLogId);

    const currentStep = steps[stepIndex];
    const currentBranch = isClicked ? currentStep?.onClicked : currentStep?.onNotClicked;
    const branchAvailable = !!currentBranch?.prompt;

    const handleClose = (next: boolean) => {
        if (!next) {
            setPreview(null);
            setTestEmail("");
            setParentLogId(null);
            setStepIndex(0);
            setIsClicked(false);
            setLogSearch("");
        }
        onOpenChange(next);
    };

    const run = async (mode: "preview" | "send") => {
        if (!parentLogId) {
            toast.error("이전 발송 로그를 선택해주세요.");
            return;
        }
        if (!branchAvailable) {
            toast.error(`${stepIndex + 1}단계 ${isClicked ? "클릭함" : "클릭 안 함"} 분기에 프롬프트가 없습니다.`);
            return;
        }
        if (mode === "send" && (!testEmail || !testEmail.includes("@"))) {
            toast.error("유효한 테스트 수신 이메일을 입력해주세요.");
            return;
        }

        setWorking(true);
        setPreview(null);
        try {
            const res = await fetch("/api/email/auto-personalized/test-followup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    linkId,
                    parentLogId,
                    stepIndex,
                    isClicked,
                    testEmail: mode === "send" ? testEmail : undefined,
                    mode,
                }),
            });
            const result = await res.json();
            if (!result.success) {
                toast.error(result.error || "처리에 실패했습니다.");
                return;
            }
            setPreview(result.data);
            toast.success(mode === "send" ? `테스트 후속 메일이 ${testEmail}로 발송되었습니다.` : "미리보기 생성 완료");
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "오류가 발생했습니다.");
        } finally {
            setWorking(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-3xl px-0">
                <DialogHeader className="px-6">
                    <DialogTitle>후속 메일 테스트</DialogTitle>
                    <DialogDescription>
                        &quot;{linkName}&quot; 규칙의 후속 메일을 실제 발송 데이터 기준으로 미리 생성하거나 테스트
                        발송합니다.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="max-h-[65vh] w-full">
                    <div className="w-0 min-w-full px-6">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : !link ? (
                            <p className="text-sm text-muted-foreground py-6">규칙 정보를 불러오지 못했습니다.</p>
                        ) : steps.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6">이 규칙에는 후속 발송 설정이 없습니다.</p>
                        ) : logs.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6">
                                이 규칙으로 발송된 이력이 없습니다. 먼저 본 메일이 1건 이상 발송되어야 후속 테스트가
                                가능합니다.
                            </p>
                        ) : (
                            <div className="space-y-4 min-w-0">
                                <div className="space-y-2 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <Label>이전 발송 로그</Label>
                                        <span className="text-xs text-muted-foreground">
                                            {filteredLogs.length} / {logs.length}건
                                        </span>
                                    </div>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            value={logSearch}
                                            onChange={(e) => setLogSearch(e.target.value)}
                                            placeholder="채널명·회사명·이메일·제목으로 검색"
                                            className="pl-8 h-9"
                                        />
                                    </div>
                                    <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                                        {filteredLogs.length === 0 ? (
                                            <p className="text-xs text-muted-foreground p-4 text-center">
                                                검색 결과가 없습니다.
                                            </p>
                                        ) : (
                                            filteredLogs.map((log) => {
                                                const active = log.id === parentLogId;
                                                return (
                                                    <button
                                                        key={log.id}
                                                        type="button"
                                                        onClick={() => setParentLogId(log.id)}
                                                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                            active
                                                                ? "bg-primary/5 ring-1 ring-inset ring-primary/30"
                                                                : "hover:bg-muted/50"
                                                        }`}
                                                    >
                                                        <div className="mt-0.5 shrink-0">
                                                            {active ? (
                                                                <Check className="h-4 w-4 text-primary" />
                                                            ) : log.isClicked ? (
                                                                <MailOpen className="h-4 w-4 text-muted-foreground" />
                                                            ) : (
                                                                <Mail className="h-4 w-4 text-muted-foreground" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span className="font-medium truncate min-w-0">
                                                                    {log.identifier || log.recipientEmail}
                                                                </span>
                                                                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                                                                    {new Date(log.sentAt).toLocaleString("ko-KR", {
                                                                        month: "2-digit",
                                                                        day: "2-digit",
                                                                        hour: "2-digit",
                                                                        minute: "2-digit",
                                                                    })}
                                                                </span>
                                                            </div>
                                                            <div className="text-xs text-muted-foreground truncate">
                                                                {log.identifier ? `${log.recipientEmail} · ` : ""}
                                                                {log.subject || "(제목 없음)"}
                                                            </div>
                                                        </div>
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                    {selectedLog && (
                                        <p className="text-xs text-muted-foreground">
                                            선택됨 →{" "}
                                            <span className="font-medium text-foreground">
                                                {selectedLog.identifier || selectedLog.recipientEmail}
                                            </span>
                                            의 레코드 데이터로 후속 메일을 생성합니다.
                                        </p>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <Label>후속 단계</Label>
                                        <Select
                                            value={String(stepIndex)}
                                            onValueChange={(v) => setStepIndex(Number(v))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {steps.map((s, idx) => (
                                                    <SelectItem key={idx} value={String(idx)}>
                                                        {idx + 1}단계 ({s.delayDays}일 후)
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>이전 메일 링크 클릭 여부</Label>
                                        <div className="flex items-center justify-between rounded-md border h-10 px-3">
                                            <span className="text-sm">{isClicked ? "클릭함" : "클릭 안 함"}</span>
                                            <Switch checked={isClicked} onCheckedChange={setIsClicked} />
                                        </div>
                                    </div>
                                </div>

                                {currentStep && (
                                    <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                                        <p className="text-xs font-medium">
                                            선택된 분기: {stepIndex + 1}단계 / {isClicked ? "클릭함" : "클릭 안 함"}
                                        </p>
                                        {branchAvailable ? (
                                            <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                                                {currentBranch?.prompt}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-destructive">
                                                이 분기에 프롬프트가 설정되어 있지 않습니다.
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="test-email">테스트 수신 이메일 (실제 발송 시 필요)</Label>
                                    <Input
                                        id="test-email"
                                        type="email"
                                        value={testEmail}
                                        onChange={(e) => setTestEmail(e.target.value)}
                                        placeholder="me@example.com"
                                        disabled={working}
                                    />
                                </div>

                                {preview && (
                                    <div className="space-y-2 min-w-0">
                                        <Label>생성된 후속 메일 미리보기</Label>
                                        <div className="rounded-md border p-3 space-y-2 min-w-0">
                                            <p className="text-sm font-medium wrap-break-word">
                                                제목: {preview.subject}
                                            </p>
                                            <div className="border-t pt-2">
                                                <iframe
                                                    srcDoc={preview.htmlBody}
                                                    className="w-full min-h-[320px] border-0"
                                                    sandbox=""
                                                />
                                            </div>
                                        </div>
                                        {preview.recordData && (
                                            <details className="text-xs text-muted-foreground">
                                                <summary className="cursor-pointer">
                                                    치환에 사용된 레코드 데이터 보기
                                                </summary>
                                                <pre className="mt-2 p-2 bg-muted rounded whitespace-pre-wrap break-all">
                                                    {JSON.stringify(preview.recordData, null, 2)}
                                                </pre>
                                            </details>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </ScrollArea>

                <DialogFooter className="px-6">
                    <Button variant="outline" onClick={() => handleClose(false)} disabled={working}>
                        닫기
                    </Button>
                    {logs.length > 0 && branchAvailable && (
                        <>
                            <Button variant="secondary" onClick={() => run("preview")} disabled={working}>
                                {working ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Eye className="h-4 w-4 mr-2" />
                                )}
                                미리보기
                            </Button>
                            <Button onClick={() => run("send")} disabled={working || !testEmail}>
                                {working ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Send className="h-4 w-4 mr-2" />
                                )}
                                테스트 발송
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
