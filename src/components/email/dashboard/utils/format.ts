export { openRateText as rateText } from "../../opens/utils/openRate";

export function countText(value: number | null) {
    return value === null ? "—" : value.toLocaleString("ko-KR");
}

export function deltaColor(delta: number | null, lowerIsBetter: boolean) {
    if (delta === null || delta === 0)
        return "text-muted-foreground";
    return (delta > 0) !== lowerIsBetter
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";
}

export function deltaText(delta: number | null, comparison: {
    from: string;
    to: string;
}) {
    return delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}% · ${comparison.from.slice(5)} ~ ${comparison.to.slice(5)} 대비`;
}
