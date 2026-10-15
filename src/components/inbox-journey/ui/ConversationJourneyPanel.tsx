"use client";
import { useState } from "react";
import { useConversationJourney } from "../hooks/useConversationJourney";
import type { JourneyEvent } from "@/components/journey/types";
function EventRow({ event }: { event: JourneyEvent }) {
    return <li className="border-l-2 border-violet-100 pl-3 py-2">
        <div className="text-[11px] text-muted-foreground">{new Date(event.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {event.channel}</div>
        <p className="mt-1 break-words text-xs">{event.label}</p>
        {typeof event.meta.duration === "number" && <span className="text-[11px] text-muted-foreground">관측 체류 {Math.max(0, Math.round(event.meta.duration))}초</span>}
        {typeof event.meta.status === "string" && <span className="text-[11px] text-muted-foreground">처리 상태: {event.meta.status}</span>}
        {!!event.children?.length && <details className="mt-1 text-xs"><summary className="cursor-pointer text-violet-700">방문 페이지·행동 {event.children.length}개</summary>
            <ol className="mt-2">{event.children.map((row, index) => <EventRow key={`${row.at}:${index}`} event={row} />)}</ol>
        </details>}
    </li>;
}
export function ConversationJourneyPanel({ id, recordId, version, canConfirm, change }: {
    id: string; recordId: number | null; version: number; canConfirm: boolean;
    change: (value: unknown) => Promise<unknown>;
}) {
    const { data, error, isLoading, mutate } = useConversationJourney(id);
    const [count, setCount] = useState(20);
    const [busy, setBusy] = useState(false);
    const [saveError, setSaveError] = useState("");
    return <section className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/30 p-3" aria-label="발송·방문·상담 경로">
        <h3 className="font-semibold">발송·방문·상담 경로</h3>
        {isLoading && <p className="text-xs">이전 경로를 불러오고 있습니다…</p>}
        {error && <div className="text-xs"><p>경로를 불러오지 못했습니다.</p><button className="mt-1 underline" onClick={() => void mutate()}>다시 불러오기</button></div>}
        {data && <>
            <p className="text-xs font-medium">{data.status === "confirmed" ? "확인된 고객 연결" : data.status === "attributed" ? `${data.evidence === "email_link" ? "메일 링크" : "방문 경로"} 유입 · 본인 미확인` : data.status === "visitor" ? "방문 브라우저 연결 · 고객 미확인" : "기존 리드 연결 전"}</p>
            {data.record && <p className="text-xs break-words">{data.record.name} · 리드 #{data.record.id}</p>}
            {data.status === "attributed" && <p className="text-xs text-muted-foreground">아래 발송 이력은 이 경로에 연결된 리드의 기록입니다. 공유 링크나 공용 브라우저의 다른 사람일 수 있어 고객 정보와 자동으로 합치지 않았습니다.</p>}
            {data.ambiguous && <p className="text-xs text-amber-800">이 브라우저에 여러 리드가 연결돼 있어 한 고객으로 정하지 않았습니다. 고객을 확인한 뒤 연결해주세요.</p>}
            {data.status === "unlinked" && <p className="text-xs text-muted-foreground">추적 링크나 확인된 회원 연결이 없습니다. 아래에서 고객을 확인해 기존 CRM에 연결할 수 있습니다.</p>}
            {data.conflict && <p className="text-xs text-amber-800">링크 수신 리드와 확인된 고객이 다릅니다. 확인된 고객의 이력을 기준으로 표시합니다.</p>}
            {!recordId && data.record && canConfirm && <button className="rounded-lg border bg-background px-3 py-2 text-xs disabled:opacity-50" disabled={busy} onClick={async () => {
                setBusy(true); setSaveError("");
                try { const changed = await change({ recordId: data.record!.id, version }); if (changed !== false) await mutate(); }
                catch (e) { setSaveError((e as Error).message); }
                finally { setBusy(false); }
            }}>{busy ? "연결 중…" : "고객 확인 후 이 리드에 연결"}</button>}
            {saveError && <p className="text-xs text-red-700" role="alert">{saveError}</p>}
            <details open><summary className="cursor-pointer text-xs">전체 경로 {data.total}건</summary>
                <ol className="mt-2">{data.events.slice(-count).map((event, index) => <EventRow key={`${event.at}:${index}`} event={event} />)}</ol>
                {data.events.length > count && <button className="mt-2 text-xs underline" onClick={() => setCount(count + 20)}>이전 경로 20건 더 보기</button>}
                {!data.total && <p className="mt-2 text-xs text-muted-foreground">아직 기록된 경로가 없습니다.</p>}
            </details>
        </>}
    </section>;
}
