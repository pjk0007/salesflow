import { cn } from "@/lib/utils";
import { statusColorStyle } from "../utils/lead-fields";

interface StatusBadgeProps {
    status: string;
    colors?: Record<string, string> | null;
    active?: boolean;
    onClick?: () => void;
    className?: string;
}

/** 대응상태 칩 — 표에서는 배지, 상세에서는 누르는 버튼 */
export function StatusBadge({ status, colors, active = true, onClick, className }: StatusBadgeProps) {
    const style = active ? statusColorStyle(status, colors) : undefined;
    const Tag = onClick ? "button" : "span";
    return (
        <Tag
            type={onClick ? "button" : undefined}
            onClick={onClick}
            style={style}
            className={cn(
                "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs",
                active
                    ? !style && "border-transparent bg-slate-100 text-slate-700"
                    : "text-muted-foreground hover:bg-muted",
                onClick && active && "ring-2 ring-ring/40",
                onClick && "cursor-pointer transition-colors",
                className,
            )}
        >
            {status}
        </Tag>
    );
}
