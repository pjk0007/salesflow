"use client";

import { useRef, useState } from "react";
import type { EsignDocument, EsignField, EsignRecipientInput, StaffEsignDetail } from "@/lib/esign/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, Check, FileUp, Plus, Save, Send, Trash2 } from "lucide-react";
import { esignApi, EsignApiError, type EsignStatus } from "../api/client";
import { clamp, displayDate, fieldLabels, roleColors } from "../utils/presentation";
import { localDateTimeValue } from "@/lib/utils";
import { AlimtalkReadiness } from "./AlimtalkReadiness";
import { PdfViewer } from "./PdfViewer";

const controlClass = "h-9 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-ring";
const newRecipient = (): EsignRecipientInput => ({ name: "", email: "", phone: "", channels: ["email"] });

export function EsignComposer({ workspaceId, templates, documentsLoading, status, initialRecipient, onClose, onSent, onDocumentSaved }: { workspaceId: number; templates: EsignDocument[]; documentsLoading?: boolean; status: EsignStatus; initialRecipient?: EsignRecipientInput; onClose: () => void; onSent: (detail: StaffEsignDetail) => void; onDocumentSaved: () => void }) {
    const [step, setStep] = useState(1);
    const [document, setDocument] = useState<EsignDocument | null>(null);
    const [fields, setFields] = useState<EsignField[]>([]);
    const [title, setTitle] = useState("");
    const [recipients, setRecipients] = useState<EsignRecipientInput[]>([{ ...newRecipient(), ...initialRecipient, channels: initialRecipient?.channels?.length ? initialRecipient.channels : ["email"] }]);
    const [recipientIndex, setRecipientIndex] = useState(0);
    const [tool, setTool] = useState<EsignField["type"]>("signature");
    const [selectedId, setSelectedId] = useState("");
    const [pageIndex, setPageIndex] = useState(0);
    const [order, setOrder] = useState<"parallel" | "sequential">("parallel");
    const [expiresAt, setExpiresAt] = useState(() => localDateTimeValue(new Date(Date.now() + 7 * 86400000)));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [outcomeUnknown, setOutcomeUnknown] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const selectedField = fields.find(field => field.id === selectedId);

    const replaceField = (next: EsignField) => setFields(items => items.map(item => item.id === next.id ? next : item));
    const updateRecipient = (index: number, patch: Partial<EsignRecipientInput>) => setRecipients(items => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    const selectDocument = (next: EsignDocument) => { setDocument(next); setTitle(next.title); setFields(next.fields); setSelectedId(""); setPageIndex(0); setRecipients(items => Array.from({ length: Math.max(items.length, ...next.fields.map(field => field.recipientIndex + 1)) }, (_, index) => items[index] || newRecipient())); };

    async function upload(file?: File) {
        if (!file) return; setBusy(true); setError(""); setNotice("");
        try { if (file.size > 10 * 1024 * 1024) throw new Error("PDF는 10MB 이하로 올려 주세요."); selectDocument(await esignApi.upload(workspaceId, file, file.name.replace(/\.pdf$/i, ""), "document")); onDocumentSaved(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 올리지 못했습니다."); }
        finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
    }

    function documentProblem() {
        if (!document) return "PDF를 올리거나 템플릿을 선택해 주세요.";
        if (!title.trim()) return "문서 제목을 입력해 주세요.";
        if (!fields.length) return "서명자가 입력할 칸을 문서에 하나 이상 배치해 주세요.";
        for (let index = 0; index < recipients.length; index++) if (!fields.some(field => field.recipientIndex === index && field.required && (field.type === "signature" || field.type === "seal"))) return `${index + 1}번 서명자에게 필수 서명 또는 도장 칸을 하나 이상 배치해 주세요.`;
        return "";
    }
    function recipientProblem() {
        for (const [index, recipient] of recipients.entries()) {
            if (!recipient.name.trim()) return `${index + 1}번 서명자 이름을 입력해 주세요.`;
            if (!recipient.channels.length) return `${index + 1}번 서명자의 발송 채널을 선택해 주세요.`;
            if (recipient.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email.trim())) return `${index + 1}번 서명자 이메일을 확인해 주세요.`;
            if (recipient.channels.includes("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email || "")) return `${index + 1}번 서명자 이메일을 확인해 주세요.`;
            if ((recipient.channels.includes("sms") || recipient.channels.includes("alimtalk")) && !/^\+?\d{8,15}$/.test((recipient.phone || "").replace(/[\s()-]/g, ""))) return `${index + 1}번 서명자 휴대폰 번호를 확인해 주세요.`;
            if (recipient.channels.includes("email") && !status.emailReady) return "이메일 발송 설정이 준비되지 않았습니다. 관리자에게 설정을 요청해 주세요.";
            if (recipient.channels.includes("alimtalk") && !status.alimtalkReady) return "알림톡 연결과 전자서명 템플릿 3종 승인이 필요합니다. 이메일만 선택해 보낼 수 있습니다.";
            if (recipient.channels.includes("sms") && !status.smsReady) return "SMS 발송 설정이 준비되지 않았습니다. 관리자에게 설정을 요청해 주세요.";
        }
        if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return "만료일은 현재 시각 이후로 설정해 주세요.";
        if (new Date(expiresAt).getTime() > Date.now() + 90 * 86400000) return "만료일은 오늘부터 90일 이내로 설정해 주세요.";
        return "";
    }
    async function saveDocument(asTemplate = false) {
        const problem = documentProblem(); if (problem || !document) { setError(problem); return null; }
        setBusy(true); setError(""); setNotice("");
        try { const saved = await esignApi.updateDocument(workspaceId, document, fields, asTemplate ? "template" : document.kind, title.trim()); setDocument(saved); onDocumentSaved(); if (asTemplate) setNotice("현재 문서와 필드 배치를 템플릿으로 저장했습니다."); return saved; }
        catch (cause) { setError(cause instanceof Error ? cause.message : "문서를 저장하지 못했습니다."); return null; }
        finally { setBusy(false); }
    }
    async function next() {
        setError(""); if (step === 1) { if (await saveDocument()) setStep(2); }
        else { const problem = recipientProblem(); if (problem) setError(problem); else setStep(3); }
    }
    async function send() {
        const problem = documentProblem() || recipientProblem(); if (problem || !document) { setError(problem); return; }
        setBusy(true); setError("");
        try { onSent(await esignApi.createEnvelope(workspaceId, { documentId: document.id, title: title.trim(), order, expiresAt: new Date(expiresAt).toISOString(), recipients: recipients.map(recipient => ({ ...recipient, name: recipient.name.trim(), email: recipient.email?.trim() || undefined, phone: recipient.phone?.replace(/[\s()-]/g, "") || undefined })) })); }
        catch (cause) {
            if (cause instanceof EsignApiError && cause.status < 500 && cause.status !== 408) setError(cause.message);
            else { setOutcomeUnknown(true); setError("요청 생성 응답을 확인하지 못했습니다. 중복 발송을 피하기 위해 요청 목록에서 생성 여부를 먼저 확인해 주세요."); }
        }
        finally { setBusy(false); }
    }

    return <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-6" aria-label="새 서명 요청">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">새 서명 요청</h2><p className="mt-1 text-sm text-muted-foreground">문서와 받는 사람을 확인한 뒤 이메일·알림톡으로 보내세요.</p></div><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>작성 닫기</Button></div>
        <AlimtalkReadiness status={status} /><ol className="grid grid-cols-3 gap-2 border-b pb-5 text-xs sm:text-sm">{["문서와 입력란", "받는 사람과 발송", "최종 확인"].map((label, index) => <li key={label} className={`flex items-center gap-2 ${step === index + 1 ? "font-semibold text-primary" : "text-muted-foreground"}`} aria-current={step === index + 1 ? "step" : undefined}><span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${step >= index + 1 ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{step > index + 1 ? <Check className="size-3.5" /> : index + 1}</span>{label}</li>)}</ol>

        {step === 1 && <div className="space-y-5">
            {!document ? <div className="grid gap-5 md:grid-cols-2">
                <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center"><FileUp className="size-8 text-primary" /><h3 className="font-semibold">PDF 직접 올리기</h3><p className="text-sm text-muted-foreground">최대 10MB · 30페이지</p><Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "문서 확인 중…" : "PDF 파일 선택"}</Button></div>
                <div className="space-y-3 rounded-xl border p-5"><h3 className="font-semibold">저장된 템플릿 사용</h3><p className="text-sm text-muted-foreground">입력란 배치까지 불러옵니다. 원본 템플릿은 보존됩니다.</p>{documentsLoading ? <p className="py-7 text-sm text-muted-foreground">템플릿을 불러오고 있습니다.</p> : templates.length ? <ul className="max-h-64 space-y-2 overflow-auto">{templates.map(template => <li key={template.id}><Button type="button" variant="outline" className="h-auto w-full justify-between whitespace-normal py-3 text-left" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { selectDocument(await esignApi.cloneDocument(workspaceId, template)); } catch (cause) { setError(cause instanceof Error ? cause.message : "템플릿을 불러오지 못했습니다."); } finally { setBusy(false); } }}><span>{template.title}</span><span className="ml-2 shrink-0 text-xs text-muted-foreground">{template.pages.length}쪽</span></Button></li>)}</ul> : <p className="py-7 text-sm text-muted-foreground">저장된 템플릿이 없습니다. PDF를 올린 뒤 템플릿으로 저장할 수 있습니다.</p>}</div>
            </div> : <>
                <div className="flex flex-wrap items-end gap-3"><label className="min-w-56 flex-1 space-y-1.5 text-sm"><span className="font-medium">문서 제목</span><Input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} /></label><Button type="button" variant="outline" disabled={busy} onClick={() => { setDocument(null); setFields([]); setNotice(""); }}>다른 문서 선택</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void saveDocument(true)}><Save />템플릿으로 저장</Button></div>
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
                    <div className="space-y-2"><p className="text-sm text-muted-foreground">오른쪽에서 입력란을 고르고 문서를 클릭하세요. 배치한 칸은 드래그하거나 방향키로 옮길 수 있습니다.</p><PdfViewer url={esignApi.documentUrl(workspaceId, document.id)} fields={fields} pageIndex={pageIndex} onPageChange={setPageIndex} selectedFieldId={selectedId} onFieldClick={field => { setSelectedId(field.id); setRecipientIndex(field.recipientIndex); }} onMove={replaceField} onPlace={(page, x, y) => {
                        const width = tool === "text" ? .28 : tool === "seal" ? .14 : .2, height = tool === "seal" ? .1 : tool === "signature" ? .07 : .04;
                        const field: EsignField = { id: crypto.randomUUID(), type: tool, recipientIndex, pageIndex: page, x: clamp(x - width / 2, 0, 1 - width), y: clamp(y - height / 2, 0, 1 - height), width, height, required: true };
                        setFields(items => [...items, field]); setSelectedId(field.id);
                    }} /></div>
                    <aside className="space-y-5 rounded-xl border p-4">
                        <label className="block space-y-2 text-sm"><span className="font-medium">입력할 사람</span><select className={controlClass} value={recipientIndex} onChange={event => setRecipientIndex(Number(event.target.value))}>{recipients.map((recipient, index) => <option key={index} value={index}>{index + 1}번 서명자{recipient.name ? ` · ${recipient.name}` : ""}</option>)}</select></label>
                        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={recipients.length >= 5} onClick={() => { setRecipients(items => [...items, newRecipient()]); setRecipientIndex(recipients.length); }}><Plus />서명자 추가</Button>{recipients.length > 1 && <Button type="button" size="sm" variant="ghost" disabled={fields.some(field => field.recipientIndex === recipients.length - 1)} title="마지막 서명자의 입력란을 지운 뒤 제외할 수 있습니다." onClick={() => { setRecipients(items => items.slice(0, -1)); setRecipientIndex(0); }}>마지막 서명자 제외</Button>}</div>
                        <div className="space-y-2"><p className="text-sm font-medium">문서에 넣을 입력란</p><div className="grid grid-cols-2 gap-2">{Object.entries(fieldLabels).map(([key, label]) => <Button key={key} type="button" size="sm" variant={tool === key ? "default" : "outline"} aria-pressed={tool === key} onClick={() => { setTool(key as EsignField["type"]); setSelectedId(""); }}>{label}</Button>)}</div><Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => {
                            const width = tool === "text" ? .28 : tool === "seal" ? .14 : .2, height = tool === "seal" ? .1 : tool === "signature" ? .07 : .04;
                            const field: EsignField = { id: crypto.randomUUID(), type: tool, recipientIndex, pageIndex, x: .4, y: .5, width, height, required: true }; setFields(items => [...items, field]); setSelectedId(field.id);
                        }}>현재 페이지 중앙에 추가</Button></div>
                        {selectedField && <div className="space-y-3 border-t pt-4"><h4 className="text-sm font-semibold">선택한 {fieldLabels[selectedField.type]}</h4><label className="block space-y-1 text-xs"><span>입력란 이름</span><Input value={selectedField.label || ""} placeholder={fieldLabels[selectedField.type]} maxLength={40} onChange={event => replaceField({ ...selectedField, label: event.target.value })} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selectedField.required} onChange={event => replaceField({ ...selectedField, required: event.target.checked })} />필수 입력</label><div className="grid grid-cols-2 gap-2">{([ ["x", "가로 위치"], ["y", "세로 위치"], ["width", "너비"], ["height", "높이"] ] as const).map(([key, label]) => <label key={key} className="space-y-1 text-xs"><span>{label} (%)</span><Input type="number" step="0.5" min={key === "width" || key === "height" ? 2 : 0} max={100} value={Math.round(selectedField[key] * 1000) / 10} onChange={event => {
                            const number = Number(event.target.value) / 100; if (!Number.isFinite(number)) return;
                            const next = { ...selectedField, [key]: clamp(number, key === "width" || key === "height" ? .02 : 0, 1) }; next.x = Math.min(next.x, 1 - next.width); next.y = Math.min(next.y, 1 - next.height); replaceField(next);
                        }} /></label>)}</div><Button type="button" size="sm" variant="destructive" className="w-full" onClick={() => { setFields(items => items.filter(field => field.id !== selectedId)); setSelectedId(""); }}><Trash2 />입력란 삭제</Button></div>}
                        <div className="space-y-2 border-t pt-4"><h4 className="text-sm font-medium">배치한 입력란 ({fields.length})</h4><ul className="max-h-48 space-y-1 overflow-auto">{fields.map(field => <li key={field.id}><button type="button" className={`w-full rounded p-2 text-left text-xs ${selectedId === field.id ? "bg-muted" : "hover:bg-muted/60"}`} onClick={() => { setSelectedId(field.id); setPageIndex(field.pageIndex); }}><span style={{ color: roleColors[field.recipientIndex] }}>{field.recipientIndex + 1}번</span> · {field.pageIndex + 1}쪽 · {field.label || fieldLabels[field.type]}{field.required && " *"}</button></li>)}</ul></div>
                    </aside>
                </div>
            </>}
            <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} accept="application/pdf,.pdf" onChange={event => void upload(event.target.files?.[0])} aria-label="PDF 파일 선택" />
        </div>}

        {step === 2 && <div className="space-y-5">
            <p className="text-sm text-muted-foreground">최대 5명에게 보낼 수 있습니다. 이메일과 알림톡을 함께 선택해도 같은 계약의 같은 서명 링크가 전달됩니다.</p>
            <div className="space-y-4">{recipients.map((recipient, index) => <fieldset key={index} className="space-y-4 rounded-xl border p-4"><legend className="px-2 text-sm font-semibold" style={{ color: roleColors[index] }}>{index + 1}번 서명자</legend><div className="grid gap-4 sm:grid-cols-3"><label className="space-y-1.5 text-sm"><span>이름 *</span><Input autoComplete="off" value={recipient.name} maxLength={60} onChange={event => updateRecipient(index, { name: event.target.value })} /></label><label className="space-y-1.5 text-sm"><span>이메일{recipient.channels.includes("email") && " *"}</span><Input type="email" autoComplete="off" placeholder="name@company.com" value={recipient.email || ""} onChange={event => updateRecipient(index, { email: event.target.value })} /></label><label className="space-y-1.5 text-sm"><span>휴대폰{(recipient.channels.includes("sms") || recipient.channels.includes("alimtalk")) && " *"}</span><Input type="tel" autoComplete="off" placeholder="010-0000-0000" value={recipient.phone || ""} onChange={event => updateRecipient(index, { phone: event.target.value })} /></label></div><div className="flex flex-wrap gap-5 text-sm">{([ ["email", "이메일", status.emailReady], ["alimtalk", "알림톡", !!status.alimtalkReady], ...(status.smsReady || recipient.channels.includes("sms") ? [["sms", "SMS", status.smsReady] as const] : []) ] as const).map(([channel, label, ready]) => <label key={channel} className="flex items-center gap-2"><input type="checkbox" disabled={!ready && !recipient.channels.includes(channel)} checked={recipient.channels.includes(channel)} onChange={event => updateRecipient(index, { channels: event.target.checked ? [...recipient.channels, channel] : recipient.channels.filter(item => item !== channel) })} />{label}{!ready && <span className="text-xs text-amber-700">{channel === "alimtalk" ? "승인·연결 필요" : "설정 필요"}</span>}</label>)}</div></fieldset>)}</div>
            <div className="grid gap-5 rounded-xl bg-muted/40 p-4 sm:grid-cols-2"><fieldset className="space-y-2"><legend className="text-sm font-medium">서명 순서</legend><label className="flex items-center gap-2 text-sm"><input type="radio" name="signing-order" checked={order === "parallel"} onChange={() => setOrder("parallel")} />동시에 요청</label><label className="flex items-center gap-2 text-sm"><input type="radio" name="signing-order" checked={order === "sequential"} onChange={() => setOrder("sequential")} />1번부터 차례로 요청</label><p className="text-xs text-muted-foreground">순차 요청은 앞사람의 서명이 끝나야 다음 사람에게 전달됩니다.</p></fieldset><label className="space-y-2 text-sm"><span className="font-medium">서명 만료일</span><Input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /><span className="block text-xs text-muted-foreground">이 기기의 현지 시각 기준입니다.</span></label></div>
        </div>}

        {step === 3 && document && <div className="space-y-5"><div className="rounded-xl bg-primary/5 p-5"><h3 className="text-lg font-semibold">{title}</h3><p className="mt-2 text-sm text-muted-foreground">{document.pages.length}페이지 · 입력란 {fields.length}개 · {order === "parallel" ? "동시 서명" : "순차 서명"}</p><p className="mt-1 text-sm">만료: {displayDate(new Date(expiresAt).toISOString())}</p></div><ul className="space-y-3">{recipients.map((recipient, index) => <li key={index} className="rounded-lg border p-4"><p className="font-semibold">{index + 1}. {recipient.name}</p><div className="mt-2 space-y-1 text-sm text-muted-foreground">{recipient.channels.includes("email") && <p>이메일: {recipient.email}</p>}{recipient.channels.includes("alimtalk") && <p>알림톡: {recipient.phone}</p>}{recipient.channels.includes("sms") && <p>SMS: {recipient.phone}</p>}<p>필수 입력란 {fields.filter(field => field.recipientIndex === index && field.required).length}개</p></div></li>)}</ul><p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">보내기를 누르면 선택한 채널로 실제 발송 작업이 생성됩니다. 받는 사람과 연락처를 확인해 주세요. 발송 후에는 문서와 수신자를 바꿀 수 없습니다.</p></div>}

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{outcomeUnknown && <Button type="button" variant="outline" onClick={onClose}>요청 목록에서 확인</Button>}{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
        <div className="flex justify-between gap-3 border-t pt-5"><Button type="button" variant="outline" disabled={busy || outcomeUnknown || step === 1} onClick={() => { setStep(value => value - 1); setError(""); }}><ArrowLeft />이전</Button>{step < 3 ? <Button type="button" disabled={busy || !document} onClick={() => void next()}>{busy ? "저장 중…" : "다음"}<ArrowRight /></Button> : <Button type="button" disabled={busy || outcomeUnknown} onClick={() => void send()}><Send />{busy ? "요청 생성 중…" : "서명 요청 보내기"}</Button>}</div>
    </section>;
}
