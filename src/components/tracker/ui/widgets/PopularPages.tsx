"use client";

interface Props {
    pages: Array<{ path: string; title: string | null; views: number }>;
}

export function PopularPages({ pages }: Props) {
    return (
        <div className="rounded-lg border bg-card p-4">
            <p className="mb-3 text-sm font-semibold">인기 페이지 TOP 10</p>
            {pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">데이터 없음</p>
            ) : (
                <ul className="space-y-1.5">
                    {pages.map((p, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 flex-1">
                                {p.title ? (
                                    <span className="text-foreground/90" title={p.path}>{p.title}</span>
                                ) : (
                                    <span className="font-mono text-xs text-foreground/80" title={p.path}>{p.path}</span>
                                )}
                                {p.title && (
                                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/70">{p.path}</span>
                                )}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{p.views.toLocaleString()}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
