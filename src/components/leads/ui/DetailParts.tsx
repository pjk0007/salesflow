/** 상세 패널 공용 — 왼쪽 이름표 + 오른쪽 값 한 줄 */
export function PropRow({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-3">
            <div className="flex w-24 shrink-0 items-center gap-1.5 pt-1 text-xs text-muted-foreground">
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
