"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { JourneyEvent } from "../types";
import { formatDateTime, channelStyle, isEmphasizedChannel } from "../utils/format";

/**
 * L2 — 시간순 통합 타임라인. 채널별 색/점, 세션 묶음은 펼치기.
 * 이벤트 클릭 시 onSelect.
 */
export function JourneyTimeline({
    events,
    onSelect,
}: {
    events: JourneyEvent[];
    onSelect: (e: JourneyEvent) => void;
}) {
    if (events.length === 0) {
        return (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
                아직 활동 내역이 없습니다.
            </div>
        );
    }

    // 날짜별 그룹
    const groups: { key: string; label: string; events: JourneyEvent[] }[] = [];
    for (const e of events) {
        const key = e.at.slice(0, 10);
        let g = groups.find((x) => x.key === key);
        if (!g) {
            const d = new Date(key + "T00:00:00");
            const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
            g = { key, label: `${d.getMonth() + 1}/${d.getDate()} (${wd})`, events: [] };
            groups.push(g);
        }
        g.events.push(e);
    }
    const maxCount = Math.max(...groups.map((g) => g.events.length));

    return (
        <div className="rounded-lg border bg-card divide-y">
            {groups.map((g) => {
                const isPeak = g.events.length === maxCount && maxCount > 2;
                return (
                    <div key={g.key} className="p-4">
                        <div className="mb-2 flex items-center gap-2">
                            <span className="text-xs font-semibold">{g.label}</span>
                            <span className={`text-[11px] ${isPeak ? "text-orange-600 dark:text-orange-400 font-medium" : "text-muted-foreground"}`}>
                                {g.events.length}개{isPeak ? " · 활동 집중일" : ""}
                            </span>
                        </div>
                        <ol className="relative space-y-3 before:absolute before:left-[5px] before:top-1 before:bottom-1 before:w-px before:bg-border">
                            {g.events.map((e, i) => (
                                <TimelineItem key={i} event={e} onSelect={onSelect} />
                            ))}
                        </ol>
                    </div>
                );
            })}
        </div>
    );
}

function TimelineItem({
    event,
    onSelect,
}: {
    event: JourneyEvent;
    onSelect: (e: JourneyEvent) => void;
}) {
    const [open, setOpen] = useState(false);
    const style = channelStyle(event.channel);
    const isStage = isEmphasizedChannel(event.channel);
    const hasChildren = !!event.children && event.children.length > 0;

    return (
        <li className="relative pl-5">
            <span className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${style.dot} ring-2 ring-card`} />
            <div className="flex items-start gap-2">
                <button
                    type="button"
                    onClick={() => onSelect(event)}
                    className="flex-1 text-left group"
                >
                    <div className="flex items-center gap-2">
                        <span className={`text-xs ${style.color}`}>{event.channel}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(event.at)}</span>
                    </div>
                    <p className={`text-sm group-hover:underline ${isStage ? "font-semibold" : ""}`}>
                        {event.label}
                    </p>
                </button>
                {hasChildren && (
                    <button
                        type="button"
                        onClick={() => setOpen((o) => !o)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                )}
            </div>
            {hasChildren && open && (
                <ul className="mt-1.5 space-y-0.5 border-l pl-3">
                    {event.children!.map((c, i) => (
                        <li key={i} className="text-xs text-muted-foreground truncate">
                            · {c.label}
                        </li>
                    ))}
                </ul>
            )}
        </li>
    );
}
