"use client";

import { useMemo } from "react";
import { Globe, Mail, UserPlus, GitBranch } from "lucide-react";
import type { JourneyEvent } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

const LANES = [
    { key: "사이트", label: "사이트", sub: "방문 · 페이지", icon: Globe, color: "#f97316", ring: "ring-orange-400" },
    { key: "메일", label: "메일", sub: "발송 · 클릭", icon: Mail, color: "#2563eb", ring: "ring-blue-400" },
    { key: "가입", label: "가입", sub: "전환 포인트", icon: UserPlus, color: "#ef4444", ring: "ring-red-400" },
    { key: "단계", label: "단계 전환", sub: "퍼널 진입", icon: GitBranch, color: "#a855f7", ring: "ring-purple-400" },
] as const;

function laneOf(channel: string): string {
    if (channel === "사이트") return "사이트";
    if (channel === "메일") return "메일";
    if (channel === "가입") return "가입";
    return "단계";
}
function timeLabel(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function dateLabel(key: string): string {
    const d = new Date(key + "T00:00:00");
    const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()} ${wd}`;
}

/**
 * 채널별 가로 타임라인 (스윔레인).
 * 날짜 컬럼 그리드 위에 채널 레인. 같은 컬럼 내 이벤트는 시간순 가로 배치(균등).
 * 무반응 구간 빗금. 칸당 이벤트 많으면 +N 축약.
 */
export function ChannelSwimlane({
    events,
    onSelect,
    onHover,
}: {
    events: JourneyEvent[];
    onSelect?: (e: JourneyEvent) => void;
    onHover?: (e: JourneyEvent | null) => void;
}) {
    const columns = useMemo(() => {
        const byDay = new Map<string, JourneyEvent[]>();
        for (const e of events) {
            const k = e.at.slice(0, 10);
            (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(e);
        }
        const days = [...byDay.keys()].sort();
        type Col = { type: "day"; key: string; events: JourneyEvent[] } | { type: "gap"; days: number };
        const cols: Col[] = [];
        for (let i = 0; i < days.length; i++) {
            if (i > 0) {
                const gap = Math.round((new Date(days[i]).getTime() - new Date(days[i - 1]).getTime()) / DAY_MS);
                if (gap >= 3) cols.push({ type: "gap", days: gap - 1 });
            }
            cols.push({ type: "day", key: days[i], events: byDay.get(days[i])!.sort((a, b) => +new Date(a.at) - +new Date(b.at)) });
        }
        return cols;
    }, [events]);

    if (events.length === 0) return null;
    const dayCols = columns.filter((c) => c.type === "day") as { events: JourneyEvent[] }[];
    const maxCount = Math.max(...dayCols.map((c) => c.events.length));

    return (
        <div className="rounded-lg border bg-card p-4 overflow-x-auto">
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold">채널별 가로 타임라인</p>
                    <p className="text-xs text-muted-foreground">채널이 어떻게 교차하며 전환을 만들었는지 한눈에</p>
                </div>
                <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
                    {LANES.map((l) => (
                        <span key={l.key} className="inline-flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                            {l.label}
                        </span>
                    ))}
                </div>
            </div>

            <div className="min-w-[640px]">
                {/* 날짜 헤더 */}
                <div className="flex border-b pb-2">
                    <div className="w-24 shrink-0" />
                    {columns.map((col, i) =>
                        col.type === "gap" ? (
                            <div key={i} className="flex-[0.5] min-w-[56px] flex items-center justify-center text-[11px] text-muted-foreground/50">
                                {col.days}일 무반응
                            </div>
                        ) : (
                            <div key={i} className={`flex-1 min-w-[120px] text-center ${i > 0 ? "border-l border-dashed" : ""}`}>
                                <div className={`text-xs font-medium ${col.events.length === maxCount && maxCount > 1 ? "text-orange-600 dark:text-orange-400" : ""}`}>
                                    {dateLabel(col.key)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">{col.events.length}개 이벤트</div>
                            </div>
                        )
                    )}
                </div>

                {/* 레인 */}
                {LANES.map((lane) => {
                    const LaneIcon = lane.icon;
                    return (
                        <div key={lane.key} className="flex items-stretch border-b last:border-0">
                            <div className="w-24 shrink-0 flex items-center gap-2 py-4">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full border" style={{ color: lane.color }}>
                                    <LaneIcon className="h-3.5 w-3.5" />
                                </span>
                                <div className="leading-tight">
                                    <div className="text-xs font-medium">{lane.label}</div>
                                    <div className="text-[10px] text-muted-foreground">{lane.sub}</div>
                                </div>
                            </div>
                            {columns.map((col, i) => {
                                if (col.type === "gap") {
                                    return (
                                        <div
                                            key={i}
                                            className="flex-[0.5] min-w-[56px]"
                                            style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.03) 5px, rgba(0,0,0,0.03) 10px)" }}
                                        />
                                    );
                                }
                                const laneEvents = col.events.filter((e) => laneOf(e.channel) === lane.key);
                                if (laneEvents.length === 0) {
                                    return (
                                        <div key={i} className={`relative flex-1 min-w-[120px] py-5 ${i > 0 ? "border-l border-dashed" : ""}`}>
                                            <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
                                        </div>
                                    );
                                }
                                // 하루 = 점 1개(왼쪽, 시작시각). 여러 건이면 마지막 시각은 칸 오른쪽 끝에.
                                const first = laneEvents[0];
                                const last = laneEvents[laneEvents.length - 1];
                                const multi = laneEvents.length > 1;
                                // 점이 가리키는 대상: 1건이면 그 이벤트, 여러건이면 그날 그 채널 묶음(카드에 다 표시)
                                // 묶음은 type을 "group"으로 명시 — first의 type("session" 등)이 새지 않게.
                                const groupLabel = lane.key === "사이트"
                                    ? `사이트 방문 ${laneEvents.length}회`
                                    : `${lane.label} ${laneEvents.length}건`;
                                const target: JourneyEvent = multi
                                    ? {
                                        ...first,
                                        type: "group",
                                        label: groupLabel,
                                        children: laneEvents,
                                        groupCount: laneEvents.length,
                                    }
                                    : first;
                                return (
                                    <div key={i} className={`relative flex-1 min-w-[120px] py-5 ${i > 0 ? "border-l border-dashed" : ""}`}>
                                        <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
                                        {/* 점 (왼쪽) + 시작시각 */}
                                        <button
                                            type="button"
                                            onClick={() => onSelect?.(target)}
                                            onMouseEnter={() => onHover?.(target)}
                                            onMouseLeave={() => onHover?.(null)}
                                            className="group absolute left-3 top-1/2 -translate-y-1/2 flex flex-col items-center p-1"
                                            title={multi ? `${laneEvents.length}건 (${timeLabel(first.at)}~${timeLabel(last.at)})` : first.label}
                                        >
                                            <span
                                                className="h-3.5 w-3.5 rounded-full ring-2 ring-card border-2 bg-card transition-colors group-hover:bg-current"
                                                style={{ borderColor: lane.color, color: lane.color }}
                                            />
                                            <span className="absolute top-[calc(50%+9px)] text-[9px] tabular-nums text-muted-foreground whitespace-nowrap">
                                                {timeLabel(first.at)}
                                            </span>
                                        </button>
                                        {/* 마지막 시각 (칸 오른쪽 끝) */}
                                        {multi && (
                                            <span className="absolute right-3 top-[calc(50%+9px)] text-[9px] tabular-nums text-muted-foreground whitespace-nowrap">
                                                {timeLabel(last.at)}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
