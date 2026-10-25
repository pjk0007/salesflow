"use client";

import { useState } from "react";
import type { StaffEsignDetail } from "@/lib/esign/types";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Download, RefreshCw, XCircle } from "lucide-react";
import { esignApi, downloadFile } from "../api/client";
import { channelLabels, deliveryLabels, displayDate, envelopeLabels, roleColors } from "../utils/presentation";
import { PdfViewer } from "./PdfViewer";
import { useAsyncConfirm } from "@/components/ui/alert-dialog";

const eventLabels: Record<string, string> = { "envelope.created": "서명 요청 생성", "envelope.dispatched": "서명 요청 발송", "recipient.otp_requested": "확인 코드 요청", "recipient.otp_failed": "확인 코드 재확인", "recipient.verified": "수신자 확인", "recipient.signed": "서명 제출", "envelope.rejected": "서명 거절", "envelope.cancelled": "요청 취소", "envelope.expired": "만료", "envelope.finalizing": "완료 문서 준비", "envelope.completed": "서명 완료", "delivery.result": "발송 결과 확인", "envelope.finalization_retried": "완료 PDF 다시 생성", "delivery.resent": "서명 요청 다시 보내기", "envelope.finalization_failed": "완료 문서 생성 재확인 필요" };

export function EnvelopeDetail({ detail, workspaceId, onClose, onRefresh }: { detail: StaffEsignDetail; workspaceId: number; onClose: () => void; onRefresh: () => void }) {
    const [page, setPage] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const { envelope, recipients, jobs, events } = detail;
    const ready = envelope.state === "completed" && !!envelope.finalArtifact;
    const finalizeFailed = envelope.state === "finalizing" && jobs.some(job => job.kind === "finalize" && job.state === "failed");
    const { confirm, confirmationDialog } = useAsyncConfirm();
    // 같은 서명자·채널의 가장 최근 초대가 실패/확인 필요이고 다시 보낸 작업이 대기 중이 아닐 때만 다시 보낸다(서버도 같은 조건을 확인).
    const canResend = (job: StaffEsignDetail["jobs"][number]) => {
        const recipient = recipients.find(item => item.id === job.recipientId);
        return envelope.state === "pending" && recipient?.state === "pending" && (job.state === "failed" || job.state === "unknown")
            && !(envelope.order === "sequential" && recipients.some(item => item.index < recipient.index && item.state !== "signed"))
            && !jobs.some(other => other.kind === "invitation" && other.recipientId === job.recipientId && other.channel === job.channel && (other.createdAt > job.createdAt || ["blocked", "pending", "processing"].includes(other.state)));
    };
    const resend = (job: StaffEsignDetail["jobs"][number]) => {
        const label = job.channel ? channelLabels[job.channel] : "서명 요청";
        confirm(job.state === "unknown"
            ? { title: "접수 여부를 확인하셨나요?", description: `이전 ${label} 발송은 공급자 접수 여부가 확인되지 않았습니다. 고객이 이미 받았을 수 있으니 발송 기록이나 고객에게 확인한 뒤 다시 보내 주세요.
같은 서명 링크가 다시 전달됩니다.`, confirmLabel: "확인했고 다시 보내기", onConfirm: async () => { await esignApi.resend(workspaceId, envelope.id, job.id, true); onRefresh(); } }
            : { title: `${label} 안내를 다시 보낼까요?`, description: "같은 서명 링크로 다시 보냅니다. 받는 주소나 번호가 잘못됐다면 요청을 취소하고 새로 만들어야 합니다.", confirmLabel: "다시 보내기", onConfirm: async () => { await esignApi.resend(workspaceId, envelope.id, job.id); onRefresh(); } });
    };
    async function download(url: string, name: string) { setError(""); try { await downloadFile(url, name); } catch (cause) { setError(cause instanceof Error ? cause.message : "파일을 내려받지 못했습니다."); } }

    return <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><Button type="button" variant="ghost" size="sm" className="-ml-2 mb-3" onClick={onClose}><ArrowLeft />요청 목록</Button><h2 className="text-xl font-semibold">{envelope.title}</h2><p className="mt-2 text-sm text-muted-foreground">{displayDate(envelope.createdAt)} 요청 · {envelope.order === "parallel" ? "동시 서명" : "순차 서명"}</p></div><div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-sm font-medium ${ready ? "bg-green-100 text-green-800" : envelope.state === "pending" || envelope.state === "finalizing" ? "bg-blue-50 text-blue-800" : "bg-muted text-muted-foreground"}`}>{envelopeLabels[envelope.state]}</span><Button type="button" size="icon-sm" variant="outline" aria-label="진행 상태 새로고침" onClick={onRefresh}><RefreshCw /></Button></div></div>
        {envelope.state === "finalizing" && <div role="status" className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">{finalizeFailed ? <><p>완료 PDF 생성에 실패했습니다. 저장된 서명으로 다시 생성할 수 있습니다.</p><Button className="mt-3" type="button" onClick={() => confirm({ title: "완료 PDF를 다시 생성할까요?", description: "저장된 서명과 원본을 사용합니다. 서명을 다시 요청하거나 초대를 재발송하지 않습니다.", confirmLabel: "다시 생성", onConfirm: async () => { await esignApi.retryFinalization(workspaceId, envelope.id); onRefresh(); } })}>완료 PDF 다시 생성</Button></> : "모든 서명이 모였습니다. 완료 문서를 생성·저장하고 있습니다. 준비가 끝나면 내려받을 수 있습니다."}</div>}
        {confirmationDialog}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_330px]">
            <PdfViewer key={`${envelope.id}-${ready}`} url={esignApi.envelopeUrl(workspaceId, envelope.id, ready)} fields={ready ? [] : envelope.document.fields} pageIndex={page} onPageChange={setPage} />
            <aside className="space-y-5">
                <div className="rounded-xl border p-4"><h3 className="font-semibold">서명자 진행</h3><ol className="mt-3 space-y-4">{recipients.map(recipient => <li key={recipient.id} className="space-y-2 border-b pb-3 last:border-0 last:pb-0"><div className="flex justify-between gap-2"><p className="text-sm font-semibold" style={{ color: roleColors[recipient.index] }}>{recipient.index + 1}. {recipient.name}</p><span className="text-xs">{recipient.state === "signed" ? "서명 완료" : recipient.state === "rejected" ? "거절" : envelope.order === "sequential" && recipients.some(item => item.index < recipient.index && item.state !== "signed") ? "순서 대기" : "서명 대기"}</span></div>{recipient.email && <p className="break-all text-xs text-muted-foreground">{recipient.email}</p>}{recipient.phone && <p className="text-xs text-muted-foreground">{recipient.phone}</p>}{recipient.signedAt && <p className="text-xs text-muted-foreground">{displayDate(recipient.signedAt)}</p>}<ul className="space-y-1">{jobs.filter(job => job.recipientId === recipient.id && job.kind === "invitation").map(job => <li key={job.id} className={`text-xs ${job.state === "failed" || job.state === "unknown" ? "text-amber-800" : "text-muted-foreground"}`}>{job.channel ? channelLabels[job.channel] : "발송"}: {deliveryLabels[job.state]}{job.error && <p className="mt-1 rounded bg-amber-50 p-2">{job.error}</p>}{canResend(job) && <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => resend(job)}>다시 보내기</Button>}</li>)}</ul></li>)}</ol><p className="mt-4 text-xs leading-relaxed text-muted-foreground">접수됨은 발송 공급자가 요청을 받았다는 뜻입니다. ‘확인 필요’는 중복 발송을 피하기 위해 공급자 결과를 확인해야 하는 상태입니다. 실패·확인 필요 발송은 ‘다시 보내기’로 같은 서명 링크를 다시 보낼 수 있습니다.</p></div>
                <div className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">문서와 기록</h3><p className="text-xs text-muted-foreground">만료: {displayDate(envelope.expiresAt)}</p><Button type="button" variant="outline" className="w-full" onClick={() => void download(esignApi.envelopeUrl(workspaceId, envelope.id), `${envelope.title}-원본.pdf`)}><Download />원본 PDF</Button><Button type="button" variant="outline" className="w-full" disabled={!ready} onClick={() => void download(esignApi.envelopeUrl(workspaceId, envelope.id, true), `${envelope.title}-완료.pdf`)}><Download />{ready ? "완료 PDF" : "완료 PDF 준비 전"}</Button><Button type="button" variant="ghost" className="w-full" onClick={() => void download(esignApi.auditUrl(workspaceId, envelope.id), `${envelope.title}-확인기록.json`)}><Download />확인 기록</Button></div>
                {(envelope.state === "pending" || envelope.state === "draft") && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" className="w-full text-red-700" disabled={busy}><XCircle />서명 요청 취소</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>서명 요청을 취소할까요?</AlertDialogTitle><AlertDialogDescription>이 계약의 모든 서명 링크가 중단됩니다. 이미 발송된 이메일·알림톡·SMS는 회수되지 않습니다. 다시 요청하려면 새 계약을 만들어야 합니다.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>유지하기</AlertDialogCancel><AlertDialogAction onClick={async () => { setBusy(true); setError(""); try { await esignApi.cancel(workspaceId, envelope.id); onRefresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "취소하지 못했습니다."); } finally { setBusy(false); } }}>요청 취소하기</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
            </aside>
        </div>
        <div className="rounded-xl border p-4"><h3 className="font-semibold">진행 기록</h3>{events.length ? <ol className="mt-3 space-y-3">{events.slice().reverse().map(event => <li key={event.id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{eventLabels[event.type] || "계약 진행 기록"}{event.recipientId && ` · ${recipients.find(recipient => recipient.id === event.recipientId)?.name || "서명자"}`}</span><time className="text-xs text-muted-foreground" dateTime={event.at}>{displayDate(event.at)}</time></li>)}</ol> : <p className="mt-3 text-sm text-muted-foreground">아직 진행 기록이 없습니다.</p>}</div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>;
}
