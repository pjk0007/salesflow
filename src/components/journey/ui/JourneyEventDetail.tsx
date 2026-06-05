import type { JourneyEvent } from "../types";
import { formatDateTime, channelStyle } from "../utils/format";
import { dedupStages } from "../utils/stage";
import { parseInflowDetail } from "@/components/tracker/utils/inflowDetail";

/**
 * 단계 전환 묶음 판별 — 자식에 CUSTOM 이벤트가 있으면 행동 단계 묶음.
 * (사이트 세션 묶음은 자식이 session이라 PagePathSummary로, 단계 묶음은 입력항목을 펼침)
 */
function isStageGroup(event: JourneyEvent): boolean {
    return !!event.children?.some((c) => c.type === "CUSTOM");
}

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

            {/* 단계 전환 묶음(여러 단계): 같은 단계 반복(이전→다시 다음)은 마지막 도달분으로 접어 표시.
                단계마다 라벨 + 그 단계에서 입력/선택한 항목 펼침. */}
            {event.type === "group" && isStageGroup(event) && event.children && (
                <ol className="space-y-2.5 border-t pt-2">
                    {dedupStages(event.children).map((c, i) => (
                        <li key={i} className="space-y-1.5">
                            <div className="flex items-baseline justify-between gap-2 text-xs">
                                <span className="font-medium text-foreground">{c.label}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">{formatDateTime(c.at).slice(-5)}</span>
                            </div>
                            <CustomEventProps properties={c.meta?.properties} />
                        </li>
                    ))}
                </ol>
            )}

            {/* 사이트 세션 묶음(그날 세션 여러 개): 모든 세션의 페이지를 경로별 집계 */}
            {event.type === "group" && event.source === "tracker" && !isStageGroup(event) && event.children && event.children.length > 0 && (
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

// 객체에서 사람이 읽을 "라벨" 후보 키 (객체 배열을 칩으로 펼칠 때 이 값만 뽑음)
const LABEL_KEYS = ["sub", "label", "name", "title", "value", "text"];

/** firestore Timestamp 류 객체면 epoch초 반환, 아니면 null. ({seconds,nanoseconds} 또는 {_seconds} 또는 {type:'firestore/timestamp', seconds}) */
function firestoreSeconds(o: Record<string, unknown>): number | null {
    const s = o.seconds ?? o._seconds;
    if (typeof s === "number") return s;
    return null;
}

/** epoch초 → YYYY-MM-DD (KST). */
function ymdFromSeconds(sec: number): string {
    const d = new Date(sec * 1000);
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 10);
}

/** 객체 하나를 짧은 라벨로 — 라벨키 우선, 없으면 비어있지 않은 첫 스칼라. */
function objectLabel(o: Record<string, unknown>): string | null {
    for (const k of LABEL_KEYS) {
        const v = o[k];
        if (typeof v === "string" && v.trim()) return v;
        if (typeof v === "number") return String(v);
    }
    for (const v of Object.values(o)) {
        if (typeof v === "string" && v.trim()) return v;
        if (typeof v === "number") return String(v);
    }
    return null;
}

/**
 * 값 직렬화 — raw JSON을 사람이 읽게 가공. 디하 등 사이트별 폼 구조에 하드코딩하지 않는 범용 규칙:
 *  - firestore timestamp → 날짜(YYYY-MM-DD)
 *  - 객체 배열 → 각 객체의 라벨(sub/label/name…)만 뽑아 쉼표
 *  - 스칼라 배열 → 쉼표 join
 *  - 빈 값([], {}, "", null) → null (호출부에서 숨김)
 */
function formatValue(v: unknown): string | null {
    if (v == null || v === "") return null;
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);

    if (Array.isArray(v)) {
        const parts = v
            .map((x) => {
                if (x == null || x === "") return null;
                if (typeof x === "object") {
                    const o = x as Record<string, unknown>;
                    const sec = firestoreSeconds(o);
                    if (sec != null) return ymdFromSeconds(sec);
                    return objectLabel(o) ?? null; // 라벨 못 뽑으면 버림 (raw JSON 토하지 않음)
                }
                return String(x);
            })
            .filter((p): p is string => p != null && p !== "");
        return parts.length ? parts.join(", ") : null;
    }

    if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        const sec = firestoreSeconds(o);
        if (sec != null) return ymdFromSeconds(sec);
        // 일반 객체: 라벨 1개로 축약 우선, 없으면 비어있지 않은 key: value 나열
        const label = objectLabel(o);
        if (label) return label;
        const entries = Object.entries(o)
            .map(([k, val]) => [k, formatValue(val)] as const)
            .filter((e): e is readonly [string, string] => e[1] != null);
        return entries.length ? entries.map(([k, val]) => `${k}: ${val}`).join(" / ") : null;
    }
    return null;
}

/**
 * CUSTOM 이벤트 properties 표시 — sendb.track(name, properties)로 보낸 값.
 * values(단계별 입력/선택 값)가 있으면 "필드 · 값"으로, 없으면 filled_keys(필드명)만 칩으로.
 * 내부 분석용이라 값까지 그대로 표시 (임시저장·이탈 시점 값 포함).
 */
function CustomEventProps({ properties }: { properties: unknown }) {
    if (!properties || typeof properties !== "object") return null;
    const props = properties as Record<string, unknown>;
    const filledKeys = Array.isArray(props.filled_keys) ? (props.filled_keys as unknown[]).map(String) : [];

    // values: 단계에서 입력/선택한 실제 값 (필드명 → 값)
    const valueObj = props.values && typeof props.values === "object" && !Array.isArray(props.values)
        ? (props.values as Record<string, unknown>)
        : null;
    const valuePairs = valueObj
        ? Object.entries(valueObj)
            .map(([k, v]) => [k, formatValue(v)] as const)
            .filter((pair): pair is readonly [string, string] => pair[1] !== null)
        : [];

    // values 밖의 기타 스칼라 속성 (filled_keys/step/values 제외)
    const extras = Object.entries(props).filter(
        ([k, v]) => k !== "filled_keys" && k !== "step" && k !== "values" && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"),
    );

    // values가 있으면 값 우선 표시, 없을 때만 filled_keys 칩으로 fallback
    const showFilledChips = valuePairs.length === 0 && filledKeys.length > 0;
    if (valuePairs.length === 0 && !showFilledChips && extras.length === 0) return null;

    return (
        <div className="space-y-1.5">
            {valuePairs.length > 0 && (
                <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">입력·선택한 값</span>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                        {valuePairs.map(([k, v]) => (
                            <div key={k} className="contents">
                                <dt className="text-muted-foreground">{k}</dt>
                                <dd className="break-all text-foreground">{v}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
            {showFilledChips && (
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
