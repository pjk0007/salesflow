import { cn } from "@/lib/utils";

/** 기간 고르기 — 묶음 버튼 (리드통계·리드젠통계 공통) */
export function RangePills({ ranges, value, onChange }: { ranges: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void }) {
    return (
        <div className="flex h-9 items-center gap-0.5 rounded-md bg-muted p-1">
            {ranges.map((r) => (
                <button
                    key={r.value}
                    type="button"
                    onClick={() => onChange(r.value)}
                    className={cn(
                        "flex h-7 items-center rounded px-3 text-xs transition-colors",
                        value === r.value ? "bg-background font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {r.label}
                </button>
            ))}
        </div>
    );
}
