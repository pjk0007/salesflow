import { Zap, Star, Info } from "lucide-react";
import type { NextAction } from "../types";

const LEVEL_STYLE: Record<NextAction["level"], { icon: typeof Zap; cls: string; tag: string }> = {
    urgent: { icon: Zap, cls: "border-rose-200 bg-rose-50 dark:bg-rose-950/30", tag: "긴급" },
    important: { icon: Star, cls: "border-amber-200 bg-amber-50 dark:bg-amber-950/30", tag: "중요" },
    info: { icon: Info, cls: "border-border bg-muted/40", tag: "참고" },
};

/**
 * 다음 액션 제안 — 룰 기반 추천.
 */
export function NextActionCard({ actions }: { actions: NextAction[] }) {
    if (actions.length === 0) return null;

    return (
        <div className="rounded-lg border bg-card p-4 space-y-2">
            <p className="text-sm font-semibold">다음 액션 제안</p>
            <div className="space-y-1.5">
                {actions.map((a, i) => {
                    const s = LEVEL_STYLE[a.level];
                    const Icon = s.icon;
                    return (
                        <div key={i} className={`flex items-center gap-2.5 rounded-md border px-3 py-2 ${s.cls}`}>
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{a.label}</p>
                                <p className="text-xs text-muted-foreground">{a.reason}</p>
                            </div>
                            <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">{s.tag}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
