/** 비율 링 — 가운데 큰 숫자 */
export function Ring({ ratio, label, sub }: { ratio: number | null; label: string; sub?: string }) {
    const r = 54;
    const c = 2 * Math.PI * r;
    const v = ratio ?? 0;
    return (
        <div className="flex flex-col items-center">
            <div className="relative size-36">
                <svg viewBox="0 0 128 128" className="size-full -rotate-90">
                    <circle cx="64" cy="64" r={r} fill="none" stroke="var(--muted)" strokeWidth="10" />
                    <circle
                        cx="64"
                        cy="64"
                        r={r}
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${c * v} ${c}`}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-semibold tabular-nums">{ratio === null ? "-" : `${(v * 100).toFixed(1)}%`}</span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                </div>
            </div>
            {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}
