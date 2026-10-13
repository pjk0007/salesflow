export function plannedSamplePerArm(baseline: number, mde: number) {
    const candidate = baseline + mde,
        pooled = (baseline + candidate) / 2;
    if (baseline <= 0 || mde <= 0 || candidate >= 1)
        throw new Error("기준 전환율과 탐지할 차이를 확인해 주세요.");
    return Math.ceil(
        (1.959963984540054 * Math.sqrt(2 * pooled * (1 - pooled)) +
            0.8416212335729143 *
                Math.sqrt(baseline * (1 - baseline) + candidate * (1 - candidate))) **
            2 /
            mde ** 2,
    );
}
