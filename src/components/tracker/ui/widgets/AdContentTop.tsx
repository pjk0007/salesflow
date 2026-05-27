"use client";

interface AdContent {
    content: string;
    sessions: number;
    leads: number;
    leadRate: number;
    source: string | null;
    medium: string | null;
    campaign: string | null;
}

interface Props {
    items: AdContent[];
}

// utm_source/medium 조합을 사람이 읽는 채널 라벨로 (classifyInflow 정책 일치)
function sourceLabel(source: string | null, medium: string | null): string | null {
    if (!source && !medium) return null;
    const s = (source ?? "").toLowerCase();
    const m = (medium ?? "").toLowerCase();
    if (s === "google" && (m === "cpc" || m === "paid" || m === "pmax")) return "구글 검색광고";
    if (s === "naver" && (m === "cpc" || m === "paid")) return "네이버 검색광고";
    if (s === "meta" || s === "facebook" || s === "instagram") return "메타 광고";
    if (s === "email" || m === "email" || m === "sales") return "메일";
    if (s === "google") return "구글";
    if (s === "naver") return "네이버";
    if (s === "blog") return "블로그";
    if (s) return source!;
    return null;
}

export function AdContentTop({ items }: Props) {
    const max = items.reduce((m, i) => Math.max(m, i.sessions), 0);
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-sm font-semibold">광고 소재 TOP</p>
            <p className="mb-3 text-[11px] text-muted-foreground">utm_content 기준 · 출처는 가장 많이 묶인 캠페인</p>
            {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">소재 데이터 없음 (utm_content 없음)</p>
            ) : (
                <ul className="space-y-2.5">
                    {items.map((c) => {
                        const pct = max > 0 ? (c.sessions / max) * 100 : 0;
                        const label = sourceLabel(c.source, c.medium);
                        return (
                            <li key={c.content} className="space-y-1 text-xs">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate font-mono text-foreground" title={c.content}>{c.content}</span>
                                        {label && (
                                            <span
                                                className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                                title={[c.source, c.medium, c.campaign].filter(Boolean).join(" / ")}
                                            >
                                                {label}
                                            </span>
                                        )}
                                    </div>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                        {c.sessions} 세션 · {c.leads} 리드 · <span className="font-medium text-foreground">{c.leadRate}%</span>
                                    </span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
