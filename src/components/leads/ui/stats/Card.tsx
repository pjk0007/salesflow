import { cn } from "@/lib/utils";

/** 통계 카드 — 아주 연한 테두리, 그림자 없음, 작은 라운드 (페이지 바탕은 옅은 회색) */
export function StatCard({ title, action, className, children }: { title?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
    return (
        <section className={cn("rounded-lg border border-border/40 bg-card p-5", className)}>
            {(title || action) && (
                <div className="mb-4 flex items-center justify-between gap-2">
                    {title && <h2 className="text-sm font-medium text-foreground/80">{title}</h2>}
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

/** 큰 숫자 + 작은 설명 */
export function BigNumber({ value, unit, sub }: { value: string; unit?: string; sub?: React.ReactNode }) {
    return (
        <div>
            <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight tabular-nums">{value}</span>
                {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
            </div>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        </div>
    );
}
