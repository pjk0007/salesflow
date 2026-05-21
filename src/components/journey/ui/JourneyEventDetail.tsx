import type { JourneyEvent } from "../types";
import { formatDateTime, channelStyle } from "../utils/format";

/**
 * 선택/호버 이벤트 상세 카드. 채널별로 의미있는 메타만 정리해서 표시.
 */
export function JourneyEventDetail({ event }: { event: JourneyEvent; onClose?: () => void }) {
    const style = channelStyle(event.channel);
    const meta = event.meta ?? {};

    return (
        <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium`}>
                        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                        {event.channel}
                    </span>
                    <span className="text-base font-semibold">{event.label}</span>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(event.at)}</span>
            </div>

            {/* 전환 강조 (가입/단계) */}
            {(event.channel === "가입" || event.source === "business") && meta.from != null && (
                <p className="text-sm text-foreground/80">
                    {String(meta.from)} → <span className="font-semibold">{String(meta.to ?? event.label)}</span>
                </p>
            )}

            {/* 사이트: 방문 페이지 칩 */}
            {event.children && event.children.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">방문 페이지 {event.children.length}개</p>
                    <div className="flex flex-wrap gap-1.5">
                        {event.children.map((c, i) => {
                            const path = String((c.meta?.pageUrl as string) ?? "").replace(/^https?:\/\/[^/]+/, "") || "/";
                            return (
                                <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px]">
                                    <span className="font-mono text-muted-foreground">{path}</span>
                                    <span className="text-foreground/70">{c.label !== path ? c.label : ""}</span>
                                </span>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 메일: 제목/CTA/URL */}
            {event.source === "email" && (
                <div className="space-y-0.5 text-xs text-muted-foreground">
                    {meta.subject != null && <p>제목 · {String(meta.subject)}</p>}
                    {meta.url != null && <p>링크 · <span className="font-mono">{String(meta.url)}</span></p>}
                </div>
            )}

            {/* 하단 메타: 유입/디바이스/UTM */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                {meta.inflowChannel != null && <span>유입 · {String(meta.inflowChannel)}</span>}
                {meta.referrer != null && !meta.inflowChannel && <span>출처 · {String(meta.referrer)}</span>}
                {meta.by != null && <span>수정자 · {String(meta.by).slice(0, 8)}</span>}
                {meta.trigger != null && <span>경로 · {String(meta.trigger)}</span>}
            </div>
        </div>
    );
}
