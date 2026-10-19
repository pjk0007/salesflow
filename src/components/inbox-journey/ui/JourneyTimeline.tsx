import type { JourneyEvent } from "@/components/journey/types";
import { customerTimeline } from "../utils/timeline";

function EventRow({ event }: { event: JourneyEvent }) {
    return <li className="border-l-2 border-violet-100 py-2 pl-3">
        <div className="text-[11px] text-muted-foreground">{new Date(event.at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {event.channel}</div>
        <p className="mt-1 break-words text-xs">{event.label}</p>
        {typeof event.meta.duration === "number" && <p className="text-[11px] text-muted-foreground">관측 체류 {Math.max(0, Math.round(event.meta.duration))}초</p>}
        {typeof event.meta.status === "string" && <p className="text-[11px] text-muted-foreground">처리 상태: {({ sent: "발송", pending: "대기", failed: "실패", success: "완료", demo: "가상 검수" } as Record<string, string>)[event.meta.status] ?? event.meta.status}</p>}
        {typeof event.meta.stageName === "string" && <p className="text-[11px] text-muted-foreground">단계: {event.meta.stageName}</p>}
        {typeof event.meta.actorName === "string" && <p className="text-[11px] text-muted-foreground">담당: {event.meta.actorName}</p>}
        {typeof event.meta.questions === "number" && <p className="text-[11px] text-muted-foreground">고객 문의 {event.meta.questions}건 · 상담 답변 {Number(event.meta.replies)}건</p>}
        {!!event.children?.length && <div className="mt-2">
            <p className="text-[11px] text-violet-700">방문 페이지·행동 {event.children.length}개</p>
            <ol className="mt-1">{event.children.map((row, index) => <EventRow key={`${row.at}:${index}`} event={row} />)}</ol>
        </div>}
    </li>;
}
export function JourneyTimeline({ events }: { events: JourneyEvent[] }) {
    const rows = customerTimeline(events);
    return <div>
        <p className="text-xs font-medium">전체 경로 {rows.length}건 · 시간순</p>
        <ol className="mt-2">{rows.map((event, index) => <EventRow key={`${event.at}:${index}`} event={event} />)}</ol>
        {!rows.length && <p className="mt-2 text-xs text-muted-foreground">아직 기록된 경로가 없습니다.</p>}
    </div>;
}
