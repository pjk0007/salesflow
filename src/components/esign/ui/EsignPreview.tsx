"use client";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { esignApi } from "../api/client";

export function EsignPreviewNotice() {
    return <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><h2 className="font-semibold">전자서명 가상 체험</h2><p>준비된 가상 계약서로 요청 → 확인 코드 → 서명·도장 → 완료 PDF까지 직접 확인하세요. 이메일과 SMS는 실제로 발송되지 않습니다.</p><p>새 요청의 가상 수신자: customer@isolated.example.test / 01000000001</p><p className="text-xs">실제 계약서·고객 정보·본인 도장은 넣지 마세요. 체험 자료는 개발 서버 재시작 시 초기화됩니다.</p></div>;
}
export function EsignPreviewOutbox({ workspaceId }: { workspaceId: number }) {
    const messages = useSWR(["/esign-preview/outbox", workspaceId], () => esignApi.previewOutbox(workspaceId), { refreshInterval: 4000, shouldRetryOnError: false });
    const invitations = (messages.data || []).filter(item => item.signUrl && item.kind === "invitation");
    const unique = invitations.filter((item, index) => invitations.findIndex(other => other.signUrl === item.signUrl) === index);
    return <section className="space-y-3 rounded-xl border bg-white p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">가상 이메일·SMS 발송함</h2><Button size="sm" variant="outline" onClick={() => void messages.mutate()}>새로고침</Button></div><p className="text-sm text-muted-foreground">아래 링크를 열면 고객이 받는 화면을 볼 수 있습니다. 확인 코드를 요청하면 체험용 코드가 그 화면에 표시됩니다.</p>{messages.error ? <p role="alert" className="text-sm text-red-700">{messages.error.message}</p> : unique.length ? <ul className="space-y-2">{unique.slice(0, 5).map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 p-3"><div><p className="text-sm font-medium">{item.title}</p><p className="text-xs text-muted-foreground">{item.name} · 이메일/SMS 가상 접수</p></div><a className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" href={item.signUrl} target="_blank" rel="noreferrer">고객 서명 화면 열기</a></li>)}</ul> : <p className="text-sm text-muted-foreground">가상 예시를 준비하고 있습니다.</p>}</section>;
}
