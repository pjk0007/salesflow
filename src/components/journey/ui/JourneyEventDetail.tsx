import type { JourneyEvent } from "../types";
import { formatDateTime, channelStyle } from "../utils/format";
import { parseInflowDetail } from "@/components/tracker/utils/inflowDetail";

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

            {/* 단일 사이트 세션: 유입 상세(검색어/광고) + 방문 페이지 경로별 집계 */}
            {event.type === "session" && (
                <>
                    <InflowDetailBlock referrer={meta.referrer as string | null} landingPage={meta.landingPage as string | null} />
                    {event.children && event.children.length > 0 && <PagePathSummary pages={event.children} />}
                </>
            )}

            {/* 사이트 세션 묶음(그날 세션 여러 개): 모든 세션의 페이지를 경로별 집계 */}
            {event.type === "group" && event.source === "tracker" && event.children && event.children.length > 0 && (
                <PagePathSummary sessions={event.children} />
            )}

            {/* 그 외 묶음(메일 등 여러 건): 각 항목 시각 + 라벨 */}
            {event.type === "group" && event.source !== "tracker" && event.children && event.children.length > 0 && (
                <ul className="space-y-1">
                    {event.children.map((c, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-xs">
                            <span className="tabular-nums text-muted-foreground shrink-0">{formatDateTime(c.at).slice(-5)}</span>
                            <span className="text-foreground">{c.label}</span>
                        </li>
                    ))}
                </ul>
            )}

            {/* CUSTOM 이벤트(단계 등): 입력/속성 표시 — 어느 단계에서 무엇을 채우고 넘어갔는지 */}
            {event.type === "CUSTOM" && <CustomEventProps properties={meta.properties} />}

            {/* 메일: 제목/CTA/URL */}
            {event.source === "email" && (
                <div className="space-y-0.5 text-xs text-muted-foreground">
                    {meta.subject != null && <p>제목 · {String(meta.subject)}</p>}
                    {meta.url != null && <p>링크 · <span className="font-mono">{String(meta.url).replace(/^https?:\/\//, "").split("?")[0]}</span></p>}
                </div>
            )}

            {/* 하단 메타: 수정자/경로 (사이트 유입은 위 InflowDetailBlock에서 표시) */}
            {(meta.by != null || meta.trigger != null) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
                    {meta.by != null && <span>수정자 · {String(meta.by).slice(0, 8)}</span>}
                    {meta.trigger != null && <span>경로 · {String(meta.trigger)}</span>}
                </div>
            )}
        </div>
    );
}

/**
 * CUSTOM 이벤트 properties 표시 — sendb.track(name, properties)로 보낸 값.
 * filled_keys(채운 필드명 배열)는 칩으로, 그 외 스칼라는 key·value로.
 * (개인정보 보호상 보통 값이 아니라 "어느 필드를 채웠나"만 담김)
 */
function CustomEventProps({ properties }: { properties: unknown }) {
    if (!properties || typeof properties !== "object") return null;
    const props = properties as Record<string, unknown>;
    const filledKeys = Array.isArray(props.filled_keys) ? (props.filled_keys as unknown[]).map(String) : [];
    // filled_keys / step 외 나머지 스칼라 속성
    const extras = Object.entries(props).filter(
        ([k, v]) => k !== "filled_keys" && k !== "step" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"),
    );
    if (filledKeys.length === 0 && extras.length === 0) return null;
    return (
        <div className="space-y-1.5">
            {filledKeys.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">입력한 항목</span>
                    {filledKeys.map((k) => (
                        <span key={k} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">{k}</span>
                    ))}
                </div>
            )}
            {extras.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {extras.map(([k, v]) => (
                        <span key={k} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {k} · {String(v)}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

/** 사이트 세션 유입 상세 — 채널/검색어/광고키워드/소재. (트래커 방문자 상세와 동일 파서) */
function InflowDetailBlock({ referrer, landingPage }: { referrer: string | null; landingPage: string | null }) {
    if (!referrer && !landingPage) return null;
    const inflow = parseInflowDetail(referrer ?? null, landingPage ?? null);
    return (
        <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">유입</span>
                <span className="font-medium">{inflow.channel}</span>
                {inflow.isPaid && (
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">광고</span>
                )}
            </div>
            {(inflow.searchQuery || inflow.adKeyword || inflow.adContent) && (
                <div className="flex flex-wrap gap-1.5">
                    {inflow.searchQuery && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px]">검색어 · {inflow.searchQuery}</span>
                    )}
                    {inflow.adKeyword && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px]">광고키워드 · {inflow.adKeyword}</span>
                    )}
                    {inflow.adContent && (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">소재 · {inflow.adContent}</span>
                    )}
                </div>
            )}
        </div>
    );
}

function pathOf(e: JourneyEvent): string {
    const raw = String((e.meta?.pageUrl as string) ?? "");
    return raw.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";
}

// 페이지 표시명: 타이틀 우선("구독 신청 | 디하" → "구독 신청"), 없으면 경로
function titleOf(e: JourneyEvent, path: string): string {
    const t = String(e.label ?? "").split("|")[0].split(" - ")[0].trim();
    return t && t !== path ? t : path;
}

// 대시보드/홈성 경로 — 의미가 옅어 뒤로 보냄 (영업 신호가 약함)
function isLowSignalPath(p: string): boolean {
    return p === "/" || p === "/main/" || p === "/login/" || p === "/main";
}

/**
 * 방문 페이지를 경로별로 집계해 표시 (경로 + 방문횟수).
 * pages: 페이지 이벤트 배열(단일 세션) / sessions: 세션 배열(children에 페이지, 묶음).
 * 신청·요금제 같은 의미있는 경로 우선, 홈/대시보드는 뒤로. 8개 초과는 +N 축약.
 */
function PagePathSummary({ pages, sessions }: { pages?: JourneyEvent[]; sessions?: JourneyEvent[] }) {
    const flat: JourneyEvent[] = pages ?? (sessions ?? []).flatMap((s) => s.children ?? []);
    const MAX = 8;
    // 경로를 키로 집계, 표시는 타이틀
    const order: string[] = [];
    const counts = new Map<string, number>();
    const titles = new Map<string, string>();
    for (const e of flat) {
        const p = pathOf(e);
        if (!counts.has(p)) {
            order.push(p);
            titles.set(p, titleOf(e, p));
        }
        counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    // 의미있는 페이지 먼저, 홈/대시보드는 뒤로 (각 그룹 내 등장순서 유지)
    const sorted = [...order].sort((a, b) => Number(isLowSignalPath(a)) - Number(isLowSignalPath(b)));
    const shown = sorted.slice(0, MAX);
    const rest = sorted.length - shown.length;
    return (
        <div className="flex flex-wrap gap-1.5">
            {shown.map((path) => {
                const n = counts.get(path)!;
                const low = isLowSignalPath(path);
                return (
                    <span
                        key={path}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ${low ? "bg-muted/50" : "bg-muted"}`}
                        title={path}
                    >
                        <span className={low ? "text-muted-foreground/60" : "text-foreground/80"}>{titles.get(path)}</span>
                        {n > 1 && <span className="font-medium text-foreground/70">×{n}</span>}
                    </span>
                );
            })}
            {rest > 0 && <span className="text-[11px] text-muted-foreground">+{rest}</span>}
        </div>
    );
}
