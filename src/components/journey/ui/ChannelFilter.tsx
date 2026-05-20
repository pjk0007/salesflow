const CHANNELS = [
    { value: "business", label: "비즈니스" },
    { value: "tracker", label: "사이트" },
    { value: "email", label: "메일" },
] as const;

/**
 * 채널(source) 필터 칩. 빈 배열 = 전체.
 */
export function ChannelFilter({
    selected,
    onChange,
}: {
    selected: string[];
    onChange: (next: string[]) => void;
}) {
    const toggle = (v: string) => {
        onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
    };
    const isAll = selected.length === 0;

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <button
                type="button"
                onClick={() => onChange([])}
                className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                    isAll ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted"
                }`}
            >
                전체
            </button>
            {CHANNELS.map((c) => {
                const on = selected.includes(c.value);
                return (
                    <button
                        key={c.value}
                        type="button"
                        onClick={() => toggle(c.value)}
                        className={`rounded-full px-3 py-1 text-xs border transition-colors ${
                            on ? "bg-foreground text-background border-foreground" : "border-border hover:bg-muted"
                        }`}
                    >
                        {c.label}
                    </button>
                );
            })}
        </div>
    );
}
