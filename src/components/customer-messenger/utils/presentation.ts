export function supportHoursText(
    weekly: { day: number; start: string; end: string }[],
) {
    if (!weekly.length) return "운영시간을 확인 중입니다.";
    const groups = new Map<string, number[]>();
    for (const row of weekly) {
        const key = `${row.start}~${row.end}`;
        groups.set(key, [...(groups.get(key) ?? []), row.day]);
    }
    return [...groups]
        .map(([hours, days]) => {
            const d = [...new Set(days)].sort().join(",");
            const label =
                d === "1,2,3,4,5"
                    ? "평일"
                    : d === "0,1,2,3,4,5,6"
                      ? "매일"
                      : days.map((n) => "일월화수목금토"[n]).join("·");
            return `${label} ${hours}`;
        })
        .join(" / ");
}

export function customerWelcome(name?: string) {
    const clean = name?.trim();
    return !clean || clean === "방문 고객"
        ? "안녕하세요!"
        : `안녕하세요, ${clean.replace(/님$/, "")}님!`;
}
