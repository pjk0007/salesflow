import { cn } from "@/lib/utils";
import { memoKindOf } from "../../utils/memo-kinds";

/** 연락 종류별 숫자 — 아이콘 칩 + 큰 숫자 + 얇은 진행 막대 */
export function KindList({ items, format }: { items: Array<{ kind: string; value: number }>; format: (v: number) => string }) {
    const max = Math.max(1, ...items.map((i) => i.value));
    if (items.length === 0) return <p className="py-6 text-sm text-muted-foreground">데이터가 없습니다.</p>;
    return (
        <ul className="space-y-3">
            {items.map((i) => {
                const k = memoKindOf(i.kind) ?? memoKindOf("etc")!;
                return (
                    <li key={i.kind} className="flex items-center gap-3">
                        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", k.className)}>
                            <k.icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between text-sm">
                                <span className="text-muted-foreground">{k.label}</span>
                                <span className="font-semibold tabular-nums">{format(i.value)}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(3, (i.value / max) * 100)}%` }} />
                            </div>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
