"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/page-header";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { FileSignature, Plus, RefreshCw, Search } from "lucide-react";
import { esignApi } from "../api/client";
import { displayDate, envelopeLabels } from "../utils/presentation";
import { EsignComposer } from "./EsignComposer";
import { EnvelopeDetail } from "./EnvelopeDetail";
import { EsignPreviewNotice, EsignPreviewOutbox } from "./EsignPreview";

export function EsignWorkspace() {
    const params = useSearchParams();
    if (params.get("preview") === "1") return <PreviewWorkspace />;
    return <><StandardWorkspace />{process.env.NEXT_PUBLIC_APP_URL === "https://port-next-sendb-dev-1ru12mlw8nvyar.sel5.cloudtype.app" && <a className="mt-4 inline-flex rounded-md border px-4 py-2 text-sm text-blue-700" href="/esign?preview=1">가상 계약서로 전자서명 체험하기</a>}</>;
}
function PreviewWorkspace() {
    const [workspaceId, setWorkspaceId] = useState(101);
    return <div className="space-y-5"><PageHeader title="전자서명 체험" description="가상 계약서로 직원 화면과 고객 화면을 모두 확인하세요." /><EsignPreviewNotice /><label className="flex items-center gap-3 text-sm">가상 사업<select aria-label="전자서명 체험 사업" className="h-10 rounded-md border bg-background px-3" value={workspaceId} onChange={event => setWorkspaceId(Number(event.target.value))}><option value={101}>디하 체험</option><option value={102}>백오랩 체험</option></select></label><EsignPreviewOutbox workspaceId={workspaceId} /><WorkspaceContent key={workspaceId} workspaceId={workspaceId} preview /></div>;
}
function StandardWorkspace() {
    const params = useSearchParams();
    const { workspaces, isLoading: workspaceLoading } = useWorkspaces();
    const [selection, setSelection] = useState(Number(params.get("workspaceId")) || 0);
    const workspaceId = workspaces.find(item => item.id === selection)?.id || workspaces[0]?.id;
    return <div className="space-y-6"><PageHeader title="전자서명" description="계약서를 준비하고 이메일·SMS로 서명을 요청하세요." />{workspaceLoading ? <p className="py-10 text-sm text-muted-foreground">워크스페이스를 불러오고 있습니다.</p> : !workspaceId ? <p className="rounded-xl border p-8 text-sm text-muted-foreground">사용할 수 있는 워크스페이스가 없습니다.</p> : <><label className="inline-flex items-center gap-3 text-sm"><span className="sr-only">워크스페이스</span><select aria-label="전자서명 워크스페이스" className="h-10 min-w-56 rounded-md border bg-background px-3" value={workspaceId} onChange={event => setSelection(Number(event.target.value))}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><WorkspaceContent key={workspaceId} workspaceId={workspaceId} recordId={Number(params.get("recordId")) || undefined} contactId={params.get("contactId") || undefined} /></>}</div>;
}

function WorkspaceContent({ workspaceId, recordId, contactId, preview = false }: { workspaceId: number; recordId?: number; contactId?: string; preview?: boolean }) {
    const scope = preview ? "/esign-preview" : "/esign";
    const status = useSWR([scope, "status"], esignApi.status);
    const enabled = status.data?.enabled && status.data.storageReady && status.data.databaseReady;
    const documents = useSWR(enabled ? [scope, "documents", workspaceId] : null, () => esignApi.documents(workspaceId));
    const envelopes = useSWR(enabled ? [scope, "envelopes", workspaceId] : null, () => esignApi.envelopes(workspaceId), { refreshInterval: data => data?.some(item => item.envelope.state === "pending" || item.envelope.state === "finalizing") ? 10000 : 0 });
    const prefill = useSWR(enabled && (recordId || contactId) ? [scope, "prefill", workspaceId, recordId, contactId] : null, () => esignApi.prefill(workspaceId, { recordId, contactId }));
    const [composing, setComposing] = useState(!!(recordId || contactId));
    const [selectedId, setSelectedId] = useState("");
    const [search, setSearch] = useState("");
    const detail = useSWR(enabled && selectedId ? [scope, "detail", workspaceId, selectedId] : null, () => esignApi.detail(workspaceId, selectedId), { refreshInterval: data => data?.envelope.state === "pending" || data?.envelope.state === "finalizing" ? 8000 : 0 });
    const [notice, setNotice] = useState("");

    if (status.isLoading) return <p className="rounded-xl border p-10 text-sm text-muted-foreground">전자서명 사용 상태를 확인하고 있습니다.</p>;
    if (status.error) return <div className="space-y-3 rounded-xl border p-6"><p role="alert" className="text-sm text-red-700">전자서명 설정을 확인하지 못했습니다.</p><Button variant="outline" onClick={() => void status.mutate()}>다시 확인</Button></div>;
    if (!enabled || !status.data) return <div className="space-y-3 rounded-xl border bg-muted/20 p-6"><FileSignature className="size-7 text-muted-foreground" /><h2 className="text-lg font-semibold">전자서명 사용 준비 중</h2><p className="text-sm text-muted-foreground">문서 저장과 발송 설정이 준비되면 사용할 수 있습니다.</p>{status.data?.issues.length ? <ul className="list-inside list-disc space-y-1 text-sm text-amber-800">{status.data.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : null}<Button variant="outline" size="sm" onClick={() => void status.mutate()}><RefreshCw />상태 다시 확인</Button></div>;
    if (selectedId && detail.isLoading) return <p className="rounded-xl border p-10 text-sm text-muted-foreground">서명 요청을 불러오고 있습니다.</p>;
    if (selectedId && detail.error) return <div className="space-y-3 rounded-xl border p-6"><p role="alert" className="text-sm text-red-700">{detail.error.message}</p><Button variant="outline" onClick={() => setSelectedId("")}>목록으로</Button><Button variant="outline" onClick={() => void detail.mutate()}>다시 확인</Button></div>;
    if (selectedId && detail.data) return <EnvelopeDetail detail={detail.data} workspaceId={workspaceId} onClose={() => { setSelectedId(""); void envelopes.mutate(); }} onRefresh={() => { void detail.mutate(); void envelopes.mutate(); }} />;
    if (composing) {
        if ((recordId || contactId) && prefill.isLoading) return <p className="rounded-xl border p-10 text-sm text-muted-foreground">선택한 고객의 연락처를 확인하고 있습니다.</p>;
        return <>{documents.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">템플릿을 불러오지 못했습니다. PDF 직접 업로드를 이용하거나 나중에 다시 확인해 주세요.</p>}{prefill.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">고객 연락처를 불러오지 못했습니다. 받는 사람을 직접 입력해 주세요.</p>}<EsignComposer workspaceId={workspaceId} templates={(documents.data || []).filter(item => item.kind === "template")} documentsLoading={documents.isLoading} status={status.data} initialRecipient={prefill.data} onClose={() => { setComposing(false); void envelopes.mutate(); }} onDocumentSaved={() => void documents.mutate()} onSent={result => { setComposing(false); setSelectedId(result.envelope.id); setNotice("서명 요청을 생성했습니다. 채널별 발송 결과를 확인해 주세요."); void envelopes.mutate(); }} /></>;
    }
    const list = (envelopes.data || []).filter(item => `${item.envelope.title} ${item.recipients.map(recipient => recipient.name).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
    return <div className="space-y-5">{notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}{(!status.data.emailReady || !status.data.smsReady) && <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{!status.data.emailReady && "이메일 "}{!status.data.smsReady && "SMS "}발송 설정이 필요합니다. 설정되지 않은 채널은 요청을 보낼 수 없습니다.</p>}<div className="flex flex-wrap items-center justify-between gap-3"><div className="relative min-w-56 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="계약 제목·서명자 검색" placeholder="계약 제목 또는 서명자 검색" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} /></div><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="서명 요청 목록 새로고침" onClick={() => void envelopes.mutate()}><RefreshCw /></Button><Button onClick={() => { setComposing(true); setNotice(""); }}><Plus />서명 요청</Button></div></div>{envelopes.error ? <p role="alert" className="rounded-xl border p-8 text-sm text-red-700">{envelopes.error.message}</p> : envelopes.isLoading ? <p className="rounded-xl border p-10 text-sm text-muted-foreground">서명 요청을 불러오고 있습니다.</p> : list.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-4 font-medium">문서</th><th className="p-4 font-medium">서명자</th><th className="p-4 font-medium">상태</th><th className="p-4 font-medium">요청일</th></tr></thead><tbody>{list.map(item => <tr key={item.envelope.id} className="border-b last:border-0 hover:bg-muted/30"><td className="p-4"><button type="button" className="text-left font-medium text-primary underline-offset-4 hover:underline" onClick={() => setSelectedId(item.envelope.id)}>{item.envelope.title}</button></td><td className="p-4"><p>{item.recipients.map(recipient => recipient.name).join(", ")}</p><p className="mt-1 text-xs text-muted-foreground">{item.recipients.filter(recipient => recipient.state === "signed").length}/{item.recipients.length}명 완료</p></td><td className="p-4">{envelopeLabels[item.envelope.state]}</td><td className="p-4 text-xs text-muted-foreground">{displayDate(item.envelope.createdAt)}</td></tr>)}</tbody></table></div> : <div className="flex flex-col items-center gap-3 rounded-xl border py-16 text-center"><FileSignature className="size-9 text-muted-foreground" /><h2 className="font-semibold">{search ? "검색 결과가 없습니다" : "아직 서명 요청이 없습니다"}</h2><p className="max-w-sm px-4 text-sm text-muted-foreground">PDF를 올리거나 템플릿을 선택한 뒤 이메일·SMS로 서명을 요청해 보세요.</p>{!search && <Button variant="outline" onClick={() => setComposing(true)}>첫 서명 요청 만들기</Button>}</div>}</div>;
}
