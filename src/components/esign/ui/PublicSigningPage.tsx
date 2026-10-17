/* eslint-disable @next/next/no-img-element -- Locally generated PNG previews must not be sent to an image optimizer. */
"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { EsignChannel, EsignField, PublicEsignSession } from "@/lib/esign/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Download, FileSignature, LockKeyhole, Mail, RefreshCw, Smartphone } from "lucide-react";
import { esignApi, EsignApiError, downloadFile, verificationHeaders, type SigningValue } from "../api/client";
import { displayDate, fieldLabels } from "../utils/presentation";
import { PdfViewer } from "./PdfViewer";
import { SignatureDialog } from "./SignatureDialog";

export function PublicSigningPage({ token }: { token: string }) {
    const [verificationToken, setVerificationToken] = useState("");
    const session = useSWR(["/esign/public", token, verificationToken], () => esignApi.session(token, verificationToken || undefined), { refreshInterval: data => data?.waiting || data?.envelope.state === "finalizing" ? 8000 : 0, shouldRetryOnError: false });
    return <main className="min-h-screen bg-slate-50 text-slate-900"><header className="border-b bg-white"><div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-4"><FileSignature className="size-5 text-blue-600" /><span className="font-semibold">샌드비 전자서명</span><span className="ml-auto text-xs text-slate-500">문서를 읽고 직접 서명하세요</span></div></header><div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:py-10">{session.isLoading ? <div className="rounded-xl border bg-white p-10 text-center text-sm text-slate-500">서명 요청을 확인하고 있습니다.</div> : session.error ? <div className="mx-auto max-w-lg space-y-4 rounded-xl border bg-white p-6"><h1 className="text-xl font-semibold">서명 요청을 열 수 없습니다</h1><p role="alert" className="text-sm text-red-700">{session.error.message}</p><p className="text-sm text-slate-500">링크의 만료·취소 여부를 요청자에게 확인해 주세요.</p><Button variant="outline" onClick={() => void session.mutate()}><RefreshCw />다시 확인</Button></div> : session.data ? <SigningSession key={`${session.data.envelope.id}-${session.data.recipient.id}-${session.data.verified}`} token={token} session={session.data} verificationToken={verificationToken} onVerified={setVerificationToken} onRefresh={() => session.mutate()} /> : null}<footer className="pt-3 text-center text-xs leading-relaxed text-slate-500">서명 요청의 내용이나 연락처가 다르면 요청자에게 문의해 주세요.<br />이 페이지에서는 본인의 서명만 입력할 수 있습니다.</footer></div></main>;
}

function SigningSession({ token, session, verificationToken, onVerified, onRefresh }: { token: string; session: PublicEsignSession; verificationToken: string; onVerified: (value: string) => void; onRefresh: () => Promise<PublicEsignSession | undefined> }) {
    const [channel, setChannel] = useState<EsignChannel>(session.recipient.channels[0] || "email");
    const [code, setCode] = useState("");
    const [otpSent, setOtpSent] = useState(false);
    const [otpRetryAt, setOtpRetryAt] = useState("");
    const [clock, setClock] = useState(0);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [page, setPage] = useState(0);
    const [selectedField, setSelectedField] = useState<EsignField | null>(null);
    const [values, setValues] = useState<Record<string, SigningValue>>({});
    const [consent, setConsent] = useState(false);
    const [reviewing, setReviewing] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const [uncertain, setUncertain] = useState(false);
    const submission = useRef<{ key: string; values: SigningValue[] } | null>(null);
    const finished = session.recipient.state === "signed" || session.envelope.state === "completed";
    const inactive = ["cancelled", "expired", "rejected"].includes(session.envelope.state);
    const fields = (session.document?.fields || []).filter(field => field.recipientIndex === session.recipient.index);
    const required = fields.filter(field => field.required);
    const missing = required.filter(field => !values[field.id]);
    const ready = session.envelope.state === "completed" && !!session.finalArtifact;
    const retrySeconds = otpRetryAt ? Math.max(0, Math.ceil((new Date(otpRetryAt).getTime() - clock) / 1000)) : 0;
    useEffect(() => {
        if (!otpRetryAt) return;
        setClock(Date.now());
        const interval = setInterval(() => setClock(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [otpRetryAt]);

    async function sendOtp() {
        setBusy(true); setError(""); setNotice("");
        try { const result = await esignApi.otp(token, channel); setClock(Date.now()); setOtpSent(true); setOtpRetryAt(result.retryAt || ""); setNotice(result.message || "확인 코드 발송을 요청했습니다. 도착한 코드를 입력해 주세요."); }
        catch (cause) {
            if (cause instanceof EsignApiError && cause.status < 500 && cause.status !== 408) setError(cause.message);
            else { setClock(Date.now()); setOtpSent(true); setOtpRetryAt(new Date(Date.now() + 60000).toISOString()); setError("코드 발송 결과를 확인하지 못했습니다. 코드가 도착하면 아래에 입력해 주세요. 다시 요청하려면 잠시 기다려 주세요."); }
        }
        finally { setBusy(false); }
    }
    async function verify() {
        setBusy(true); setError("");
        try { if (!/^\d{6}$/.test(code)) throw new Error("확인 코드 6자리를 입력해 주세요."); const result = await esignApi.verify(token, code); onVerified(result.verificationToken); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "확인 코드를 확인하지 못했습니다."); }
        finally { setBusy(false); }
    }
    async function submit() {
        if (!consent || missing.length) { setError("필수 입력란과 서명 동의를 확인해 주세요."); return; }
        setBusy(true); setError("");
        if (!submission.current) submission.current = { key: crypto.randomUUID(), values: Object.values(values) };
        try { await esignApi.sign(token, verificationToken, submission.current.values, submission.current.key); setReviewing(false); setValues({}); setUncertain(false); await onRefresh(); }
        catch (cause) {
            if (cause instanceof EsignApiError && cause.status < 500 && cause.status !== 408) { setError(cause.message); submission.current = null; setUncertain(false); setReviewing(false); }
            else { setUncertain(true); setError("제출 결과를 아직 확인하지 못했습니다. 내용을 바꾸지 않고 같은 요청으로 다시 확인할 수 있습니다."); }
            try { await onRefresh(); } catch { /* Keep the stable submission key while the outcome is unknown. */ }
        }
        finally { setBusy(false); }
    }
    async function downloadCompleted() {
        setError(""); try { await downloadFile(esignApi.publicDocumentUrl(token, true), `${session.envelope.title}-완료.pdf`, verificationToken); } catch (cause) { setError(cause instanceof Error ? cause.message : "완료 문서를 내려받지 못했습니다."); }
    }
    async function downloadAudit() {
        setError(""); try { await downloadFile(esignApi.publicAuditUrl(token), `${session.envelope.title}-확인기록.json`, verificationToken); } catch (cause) { setError(cause instanceof Error ? cause.message : "확인 기록을 내려받지 못했습니다."); }
    }
    const header = <div className="space-y-2"><p className="text-sm text-blue-700">{session.recipient.name} 님에게 온 서명 요청</p><h1 className="break-words text-2xl font-semibold">{session.envelope.title}</h1><p className="text-xs text-slate-500">만료: {displayDate(session.envelope.expiresAt)}</p></div>;

    if (inactive) return <div className="mx-auto max-w-xl space-y-5 rounded-xl border bg-white p-6">{header}<div className="rounded-lg bg-slate-100 p-4"><h2 className="font-semibold">{session.envelope.state === "cancelled" ? "요청이 취소되었습니다" : session.envelope.state === "expired" ? "서명 기간이 만료되었습니다" : "서명 요청이 거절되었습니다"}</h2><p className="mt-2 text-sm text-slate-600">이 링크에서는 서명을 진행할 수 없습니다. 요청자에게 문의해 주세요.</p></div></div>;
    if (session.waiting) return <div className="mx-auto max-w-xl space-y-5 rounded-xl border bg-white p-6">{header}<p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-900">앞선 서명자의 서명이 끝나면 진행할 수 있습니다. 순서가 되면 안내를 보내 드립니다.</p><Button variant="outline" onClick={() => void onRefresh()}><RefreshCw />순서 다시 확인</Button></div>;

    if (!session.verified || !verificationToken) return <section className="mx-auto max-w-lg space-y-6 rounded-xl border bg-white p-6 sm:p-8">{header}<div className="space-y-3 border-t pt-5"><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-blue-600" /><h2 className="font-semibold">먼저 받는 사람을 확인합니다</h2></div><p className="text-sm leading-relaxed text-slate-600">서명 요청에 등록된 이메일이나 휴대폰으로 확인 코드를 보냅니다. 확인 후 문서를 읽을 수 있습니다.</p><fieldset className="space-y-2"><legend className="sr-only">확인 코드를 받을 채널</legend>{session.recipient.channels.map(item => <label key={item} className={`flex items-center gap-3 rounded-lg border p-3 ${channel === item ? "border-blue-500 bg-blue-50/40" : ""}`}><input type="radio" name="verification-channel" checked={channel === item} onChange={() => { setChannel(item); setCode(""); setNotice(""); }} disabled={busy} />{item === "email" ? <Mail className="size-4 text-slate-500" /> : <Smartphone className="size-4 text-slate-500" />}<span className="min-w-0 text-sm"><span className="block font-medium">{item === "email" ? "이메일" : "SMS"}</span><span className="break-all text-xs text-slate-500">{item === "email" ? session.recipient.maskedEmail : session.recipient.maskedPhone}</span></span></label>)}</fieldset><Button className="w-full" variant={otpSent ? "outline" : "default"} disabled={busy || retrySeconds > 0} onClick={() => void sendOtp()}>{busy ? "처리 중…" : retrySeconds > 0 ? `${retrySeconds}초 후 다시 요청` : otpSent ? "확인 코드 다시 요청" : "확인 코드 받기"}</Button>{otpRetryAt && <p className="text-xs text-slate-500">재요청 가능 시각: {displayDate(otpRetryAt)}</p>}{otpSent && <form className="space-y-3 pt-2" onSubmit={event => { event.preventDefault(); void verify(); }}><label className="block space-y-2 text-sm"><span>확인 코드 6자리</span><Input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" className="h-12 text-center text-lg tracking-[.4em]" /></label><Button type="submit" className="w-full" disabled={busy || code.length !== 6}>확인하고 문서 열기</Button></form>}{notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div></section>;

    if (finished) return <section className="mx-auto max-w-xl space-y-5 rounded-xl border bg-white p-6 sm:p-8">{header}<div className="flex items-start gap-3 rounded-lg bg-green-50 p-4"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-700" /><div><h2 className="font-semibold text-green-900">서명을 제출했습니다</h2><p className="mt-2 text-sm leading-relaxed text-green-800">{ready ? "모든 서명이 완료되었습니다. 완료 문서를 내려받을 수 있습니다." : session.envelope.state === "finalizing" ? "모든 서명이 모여 완료 문서를 준비하고 있습니다." : "다른 서명자의 서명을 기다리고 있습니다. 완료되면 안내를 보내 드립니다."}</p></div></div><Button className="w-full" disabled={!ready} onClick={() => void downloadCompleted()}><Download />{ready ? "완료 PDF 내려받기" : "완료 문서 준비 전"}</Button>{ready && <Button variant="outline" className="w-full" onClick={() => void downloadAudit()}><Download />내 서명 확인 기록</Button>}{!ready && <Button variant="outline" className="w-full" onClick={() => void onRefresh()}><RefreshCw />완료 상태 확인</Button>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</section>;

    if (!session.document) return <p role="alert" className="rounded-xl border bg-white p-6 text-red-700">인증된 문서를 불러오지 못했습니다. 새로고침해 주세요.</p>;
    return <div className="space-y-5">{header}<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-3"><p className="text-sm text-slate-600">문서를 읽고 표시된 칸을 눌러 입력하세요. 제출 전에는 입력 내용을 바꿀 수 있습니다.</p><PdfViewer url={esignApi.publicDocumentUrl(token)} headers={verificationHeaders(verificationToken)} fields={fields} values={Object.fromEntries(Object.entries(values).map(([id, value]) => [id, value.pngDataUrl]))} pageIndex={page} onPageChange={setPage} onFieldClick={field => { if (!busy && !uncertain) setSelectedField(field); }} /></div><aside className="space-y-4 rounded-xl border bg-white p-4 lg:sticky lg:top-4"><div className="flex items-center justify-between"><h2 className="font-semibold">내 입력란</h2><span className="text-xs tabular-nums text-slate-500">필수 {required.length - missing.length}/{required.length}</span></div><ul className="max-h-72 space-y-2 overflow-auto">{fields.map(field => <li key={field.id}><button type="button" className={`flex w-full items-center gap-2 rounded-lg border p-3 text-left text-sm ${values[field.id] ? "border-green-200 bg-green-50/50" : "hover:bg-blue-50"}`} disabled={busy || uncertain} onClick={() => { setPage(field.pageIndex); setSelectedField(field); }}>{values[field.id] && <CheckCircle2 className="size-4 shrink-0 text-green-700" />}<span className="flex-1">{field.label || fieldLabels[field.type]}{field.required && " *"}<span className="mt-0.5 block text-xs text-slate-500">{field.pageIndex + 1}페이지</span></span><span className="text-xs text-blue-700">{values[field.id] ? "수정" : "입력"}</span></button></li>)}</ul><label className="flex items-start gap-3 border-t pt-4 text-sm leading-relaxed"><input type="checkbox" className="mt-1 size-4 shrink-0" checked={consent} disabled={busy || uncertain} onChange={event => setConsent(event.target.checked)} /><span>문서 내용을 읽고 확인했으며, 본인이 입력한 서명·도장과 정보로 이 문서에 전자서명하는 데 동의합니다.</span></label><Button className="w-full" disabled={busy || !consent || missing.length > 0} onClick={() => { setReviewing(true); setError(""); }}>{uncertain ? "제출 결과 다시 확인" : "입력 확인하고 서명하기"}</Button>{missing.length > 0 && <p className="text-xs text-slate-500">별표(*)가 있는 필수 입력란 {missing.length}개를 채워 주세요.</p>}<Button variant="ghost" className="w-full text-slate-500" disabled={busy || uncertain} onClick={() => setRejecting(true)}>이 요청 거절하기</Button>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}</aside></div>
        {selectedField && <SignatureDialog key={selectedField.id} field={selectedField} signerName={session.recipient.name} aspect={(session.document.pages[selectedField.pageIndex].width * selectedField.width) / (session.document.pages[selectedField.pageIndex].height * selectedField.height)} onClose={() => setSelectedField(null)} onSave={value => { setValues(items => ({ ...items, [value.fieldId]: value })); submission.current = null; }} />}
        <Dialog open={reviewing} onOpenChange={open => { if (!busy) setReviewing(open); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{uncertain ? "서명 제출 결과 확인" : "이 내용으로 서명할까요?"}</DialogTitle><DialogDescription>{uncertain ? "동일한 내용과 확인 번호로 다시 요청합니다. 같은 서명이 중복으로 기록되지 않습니다." : "제출하면 서명과 입력 내용을 수정할 수 없습니다. 이름과 문서의 입력 위치를 마지막으로 확인해 주세요."}</DialogDescription></DialogHeader><div className="max-h-72 space-y-3 overflow-auto rounded-lg border p-3"><p className="text-sm font-semibold">서명자: {session.recipient.name}</p>{fields.filter(field => values[field.id]).map(field => <div key={field.id} className="flex items-center gap-3 border-t pt-2"><span className="w-24 shrink-0 text-xs text-slate-500">{field.label || fieldLabels[field.type]}<br />{field.pageIndex + 1}페이지</span><img src={values[field.id].pngDataUrl} alt={`${fieldLabels[field.type]} 최종 입력`} className="h-16 min-w-0 max-w-48 flex-1 object-contain" /></div>)}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy || uncertain} onClick={() => setReviewing(false)}>돌아가 확인</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? "제출 확인 중…" : uncertain ? "같은 내용으로 다시 확인" : "동의하고 서명 제출"}</Button></DialogFooter></DialogContent></Dialog>
        <Dialog open={rejecting} onOpenChange={open => { if (!busy) setRejecting(open); }}><DialogContent><DialogHeader><DialogTitle>서명 요청을 거절할까요?</DialogTitle><DialogDescription>거절하면 이 계약의 서명을 더 진행할 수 없습니다. 요청자에게 전달할 이유를 입력할 수 있습니다.</DialogDescription></DialogHeader><label className="space-y-2 text-sm"><span>거절 이유 (선택)</span><Input value={rejectReason} onChange={event => setRejectReason(event.target.value)} maxLength={200} /></label>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRejecting(false)}>계속 서명하기</Button><Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await esignApi.reject(token, verificationToken, rejectReason); setRejecting(false); await onRefresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "거절하지 못했습니다."); } finally { setBusy(false); } }}>거절하기</Button></DialogFooter></DialogContent></Dialog>
    </div>;
}
