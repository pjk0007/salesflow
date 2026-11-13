/** 비교 묶음 A·B·C — 이름, 색, 선 모양 */
export const GROUPS = [
    { letter: "A", color: "var(--chart-1)", dash: undefined },
    { letter: "B", color: "var(--chart-3)", dash: "6 4" },
    { letter: "C", color: "var(--chart-5)", dash: "2 3" },
] as const;

/** 묶음 이름 — 메일 하나면 그 이름, 여러 개면 "첫 메일 외 N개" */
export function groupName(keys: string[], nameOf: (key: string) => string | null) {
    if (keys.length === 0) return "";
    const first = nameOf(keys[0]) ?? keys[0];
    return keys.length === 1 ? first : `${first} 외 ${keys.length - 1}개`;
}

export type CompareCardData = {
    key: string;
    label: string;
    tooltip?: string;
    rows: Array<{ group: number; value: string; best: boolean }>;
    diffText: string;
};

/**
 * 비교 카드 하나 — 묶음(기간)별 값, 가장 나은 값 표시, 1·2위 차이 문장.
 * groups: 묶음 자리(0=A…), values: 같은 순서의 값(null = 없음)
 */
export function compareCard(opts: {
    key: string;
    label: string;
    tooltip?: string;
    groups: number[];
    values: Array<number | null>;
    format: (v: number | null) => string;
    /** 차이 크기 글 (예: "3건", "1.2%p") */
    gap: (d: number) => string;
    lowerIsBetter?: boolean;
    /** "많아요"·"높아요" 등 (lowerIsBetter면 낮은 쪽이 낫다) */
    word: string;
}): CompareCardData {
    const known = opts.values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
    const sorted = [...known].sort((x, y) => (opts.lowerIsBetter ? x.v - y.v : y.v - x.v));
    const [top, second] = sorted;
    const tie = !!top && !!second && top.v === second.v;
    const letter = (i: number) => GROUPS[opts.groups[i]].letter;
    return {
        key: opts.key,
        label: opts.label,
        tooltip: opts.tooltip,
        rows: opts.values.map((v, i) => ({
            group: opts.groups[i],
            value: opts.format(v),
            best: !tie && top?.i === i,
        })),
        diffText: !top || !second ? "" : tie ? "같아요" : `${letter(top.i)}가 ${opts.gap(Math.abs(top.v - second.v))} ${opts.word}`,
    };
}
