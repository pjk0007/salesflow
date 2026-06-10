"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    ChevronDown,
    ChevronRight,
    FileText,
    Eye,
    MousePointerClick,
    Zap,
    LogOut,
    MapPin,
} from "lucide-react";
import type { TrackerSession, TrackerEvent } from "../../types";
import { parseInflowDetail } from "../../utils/inflowDetail";
import { formatDateTime, formatDuration, formatDwellMs, urlPath } from "../../utils/format";

/**
 * 세션 타임라인 — 세션을 펼치면 그 안의 행동(페이지 이동·섹션 체류·클릭)이
 * 시간순으로 보인다. 착륙 → … → 탈주.
 */
export function VisitorSessionTimeline({
    sessions,
    events,
    aliases,
}: {
    sessions: TrackerSession[];
    events: TrackerEvent[];
    aliases: Record<string, string>;
}) {
    // 최신 세션은 기본으로 펼침
    const [open, setOpen] = useState<Set<number>>(
        () => new Set(sessions.length ? [sessions[0].id] : []),
    );

    const eventsBySession = new Map<number, TrackerEvent[]>();
    for (const e of events) {
        const arr = eventsBySession.get(e.sessionId) ?? [];
        arr.push(e);
        eventsBySession.set(e.sessionId, arr);
    }

    const toggle = (id: number) =>
        setOpen((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">방문 기록 ({sessions.length})</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                    세션을 펼치면 페이지 이동·섹션 체류·클릭이 시간순으로 보입니다
                </p>
            </CardHeader>
            <CardContent>
                {sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">세션 기록 없음</p>
                ) : (
                    <ul className="space-y-2">
                        {sessions.map((s) => (
                            <SessionItem
                                key={s.id}
                                session={s}
                                events={eventsBySession.get(s.id) ?? []}
                                aliases={aliases}
                                isOpen={open.has(s.id)}
                                onToggle={() => toggle(s.id)}
                            />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

function SessionItem({
    session: s,
    events,
    aliases,
    isOpen,
    onToggle,
}: {
    session: TrackerSession;
    events: TrackerEvent[];
    aliases: Record<string, string>;
    isOpen: boolean;
    onToggle: () => void;
}) {
    const inflow = parseInflowDetail(s.referrer, s.landingPage);

    return (
        <li className="rounded border">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center gap-2 p-3 text-left text-sm hover:bg-muted/40"
            >
                {isOpen ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(s.startedAt)}
                </span>
                <span className="font-medium">{inflow.channel}</span>
                {inflow.isPaid && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">광고</Badge>
                )}
                {s.isFirstVisit === 1 && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">첫 방문</Badge>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {s.pageCount}페이지 · {formatDuration(s.duration)}
                </span>
            </button>

            {isOpen && (
                <div className="space-y-2 border-t px-3 pb-3 pt-2">
                    {(inflow.searchQuery || inflow.adKeyword || inflow.adContent || inflow.referrerHost) && (
                        <div className="flex flex-wrap gap-1.5">
                            {inflow.searchQuery && (
                                <Badge variant="outline" className="text-[11px] font-normal">
                                    검색어 · {inflow.searchQuery}
                                </Badge>
                            )}
                            {inflow.adKeyword && (
                                <Badge variant="outline" className="text-[11px] font-normal">
                                    광고키워드 · {inflow.adKeyword}
                                </Badge>
                            )}
                            {inflow.adContent && (
                                <Badge variant="outline" className="text-[11px] font-normal">
                                    소재 · {inflow.adContent}
                                </Badge>
                            )}
                            {inflow.referrerHost && (
                                <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                                    출처 · {inflow.referrerHost}
                                </Badge>
                            )}
                        </div>
                    )}

                    <ol className="space-y-0.5">
                        <TimelineRow
                            icon={<MapPin className="size-3.5 text-emerald-600" />}
                            label={`착륙 · ${urlPath(s.landingPage)}`}
                        />
                        {events.map((e) => (
                            <EventRow key={e.id} event={e} aliases={aliases} />
                        ))}
                        {s.exitPage && (
                            <TimelineRow
                                icon={<LogOut className="size-3.5 text-rose-500" />}
                                label={`탈주 · ${urlPath(s.exitPage)}`}
                                emphasize
                            />
                        )}
                    </ol>
                </div>
            )}
        </li>
    );
}

function EventRow({ event: e, aliases }: { event: TrackerEvent; aliases: Record<string, string> }) {
    const props = e.properties ?? {};
    const time = new Date(e.occurredAt).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
    });

    if (e.eventType === "PAGE_VIEW") {
        return (
            <TimelineRow
                icon={<FileText className="size-3.5 text-muted-foreground" />}
                time={time}
                label={e.pageTitle?.trim() || urlPath(e.pageUrl)}
                sub={e.pageTitle?.trim() ? urlPath(e.pageUrl) : undefined}
            />
        );
    }
    if (e.eventType === "SECTION_VIEW") {
        const dwell = typeof props.dwell_ms === "number" ? props.dwell_ms : Number(props.dwell_ms) || 0;
        const label = (e.eventName && aliases[`SECTION_VIEW:${e.eventName}`]) ?? e.eventName ?? "섹션";
        return (
            <TimelineRow
                icon={<Eye className="size-3.5 text-indigo-500" />}
                time={time}
                label={`${label} 섹션에 ${formatDwellMs(dwell)} 머묾`}
            />
        );
    }
    if (e.eventType === "CLICK") {
        const label =
            (e.eventName && aliases[`CLICK:${e.eventName}`]) ??
            (typeof props.text === "string" && props.text.trim() ? props.text : null) ??
            e.eventName ??
            "클릭";
        return (
            <TimelineRow
                icon={<MousePointerClick className="size-3.5 text-amber-500" />}
                time={time}
                label={`"${label}" 클릭`}
            />
        );
    }
    // CUSTOM 등
    return (
        <TimelineRow
            icon={<Zap className="size-3.5 text-violet-500" />}
            time={time}
            label={e.eventName ?? e.eventType}
        />
    );
}

function TimelineRow({
    icon,
    time,
    label,
    sub,
    emphasize,
}: {
    icon: React.ReactNode;
    time?: string;
    label: string;
    sub?: string;
    emphasize?: boolean;
}) {
    return (
        <li className="flex items-center gap-2 py-1 text-sm">
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {time ?? ""}
            </span>
            <span className="shrink-0">{icon}</span>
            <span
                className={`line-clamp-1 min-w-0 break-all ${emphasize ? "font-medium" : ""}`}
                title={sub ?? label}
            >
                {label}
                {sub && <span className="ml-1.5 text-[11px] text-muted-foreground">{sub}</span>}
            </span>
        </li>
    );
}
