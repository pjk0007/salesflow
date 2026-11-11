/**
 * 줄무늬 막대 — 전체를 구간별로 나눠 얇은 세로줄로 채운다 (참고: CRM 대시보드 스냅샷).
 * 구간 시작마다 위로 가는 얇은 선과 숫자·이름을 단다.
 */
export function StripeBar({ segments }: { segments: Array<{ label: string; value: number; color: string }> }) {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const visible = segments.filter((s) => s.value > 0);
    if (total === 0) return <p className="py-6 text-sm text-muted-foreground">데이터가 없습니다.</p>;
    return (
        <div>
            <div className="flex gap-1">
                {visible.map((s) => (
                    <div key={s.label} style={{ flexGrow: s.value, flexBasis: 0 }} className="min-w-14">
                        <div className="mb-2 flex items-end gap-1.5 border-l-2 pl-2" style={{ borderColor: s.color }}>
                            <div>
                                <div className="text-lg font-semibold leading-none tabular-nums">{s.value.toLocaleString()}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
                            </div>
                        </div>
                        <div
                            className="h-12 rounded-md"
                            style={{
                                backgroundImage: `repeating-linear-gradient(90deg, ${s.color} 0 2px, transparent 2px 5px)`,
                            }}
                            title={`${s.label} ${s.value}건 (${Math.round((s.value / total) * 100)}%)`}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
