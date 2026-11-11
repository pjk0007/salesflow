import { InlineEdit } from "@/components/sales/ui/InlineEdit";

/** 상세 패널 공용 — 왼쪽 이름표 + 오른쪽 값 한 줄 */
export function PropRow({
    icon: Icon,
    label,
    children,
    center,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    children: React.ReactNode;
    /** 값이 한 줄짜리 칸(고르기·바로 고치기)이면 이름표와 세로 가운데를 맞춘다 */
    center?: boolean;
}) {
    return (
        <div className={center ? "flex min-h-8 items-center gap-3" : "flex items-start gap-3"}>
            <div className={"flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground" + (center ? "" : " pt-1")}>
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

/** 상세 패널 공용 — 작은 제목 + 값 (wide면 두 칸 차지) */
export function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
    return (
        <div className={wide ? "col-span-2" : undefined}>
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-1.5 whitespace-pre-wrap break-words text-sm">{value || "-"}</div>
        </div>
    );
}

/** 상세 패널 공용 — 작은 제목 + 눌러서 바로 고치는 값 */
export function EditableField({ label, value, onSave, wide }: { label: string; value: string; onSave: (v: string) => void; wide?: boolean }) {
    return (
        <div className={wide ? "col-span-2" : undefined}>
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-0.5">
                <InlineEdit value={value} onSave={onSave} className="-ml-2" />
            </div>
        </div>
    );
}
