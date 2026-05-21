import type { JourneyAttribution } from "../types";
import { formatDateTime, channelStyle } from "../utils/format";

/**
 * 어트리뷰션 — 이 고객을 만든 채널 순서(First→...→전환)를 세로 흐름으로.
 */
export function AttributionCard({ attribution }: { attribution: JourneyAttribution }) {
    const { firstTouch, lastTouch, conversionAt, path } = attribution;
    if (!firstTouch) return null;

    // 표시 노드: 마케팅 터치들 + 전환
    const nodes = path.map((t, i) => ({
        channel: t.channel,
        at: t.at,
        gapText: t.gapText,
        kind: i === 0 ? "first" : "touch",
    }));
    if (conversionAt) {
        nodes.push({ channel: "전환", at: conversionAt, gapText: undefined, kind: "conversion" });
    }

    return (
        <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">유입 경로</p>
                <span className="text-xs text-muted-foreground">{path.length} 터치</span>
            </div>

            <ol className="relative space-y-0">
                {nodes.map((n, i) => {
                    const isConv = n.kind === "conversion";
                    const isFirst = n.kind === "first";
                    const style = isConv ? { dot: "bg-rose-500" } : channelStyle(n.channel);
                    const last = i === nodes.length - 1;
                    return (
                        <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                            {/* 연결선 */}
                            {!last && <span className="absolute left-[5px] top-4 bottom-0 w-px bg-border" />}
                            {/* 점 */}
                            <span className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot} ring-2 ring-card`} />
                            {/* 내용 */}
                            <div className="min-w-0 flex-1">
                                {n.gapText && (
                                    <p className="text-[11px] text-muted-foreground/70 -mt-0.5 mb-0.5">{n.gapText} 후</p>
                                )}
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className={`text-sm ${isConv ? "font-semibold text-rose-600 dark:text-rose-400" : isFirst ? "font-semibold text-primary" : "text-foreground"}`}>
                                        {isFirst && <span className="mr-1 text-[10px] text-muted-foreground">FIRST</span>}
                                        {n.channel}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                                        {formatDateTime(n.at)}
                                    </span>
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ol>

            {lastTouch && (
                <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
                    Last touch · <span className="text-foreground">{lastTouch.channel}</span> 이후 전환
                </p>
            )}
        </div>
    );
}
