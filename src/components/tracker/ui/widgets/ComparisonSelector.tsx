"use client";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { resolveComparisonPeriod } from "@/lib/tracker/comparison";
import { todayYmd, ymd } from "../../utils/range";
import type { ComparisonSelection, Range } from "../../types/overview";

export function ComparisonSelector({ range, value, onChange }: {
    range: Range;
    value: ComparisonSelection;
    onChange: (selection: ComparisonSelection) => void;
}) {
    const period = resolveComparisonPeriod(range, value?.from, value?.to);
    return (
        <div className="space-y-1.5 rounded-lg bg-muted/40 p-3">
            <div role="group" aria-label="비교 기간" className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">비교 기간</span>
                <Button size="sm" variant={value ? "outline" : "secondary"} aria-pressed={!value} onClick={() => onChange(null)}>
                    직전 동일 기간
                </Button>
                <DateRangePicker
                    from={value ? new Date(`${value.from}T00:00:00`) : undefined}
                    to={value ? new Date(`${value.to}T00:00:00`) : undefined}
                    maxDate={new Date()}
                    placeholder="비교 기간 직접 선택"
                    onChange={({ from, to }) => { if (from && to) onChange({ from: ymd(from), to: ymd(to) }); }}
                />
                <span className="text-xs tabular-nums text-muted-foreground">{period.from} ~ {period.to} · {period.days}일</span>
            </div>
            <p className="text-xs text-muted-foreground">
                {period.countBasis === "dailyAverage"
                    ? `조회 ${period.currentDays}일 · 비교 ${period.days}일: 방문자·세션·페이지뷰는 양쪽 일평균으로 증감률을 계산합니다.`
                    : "같은 길이의 기간입니다. 방문자·세션·페이지뷰는 합계로 증감률을 계산합니다."}
                {" "}평균 체류는 세션 평균, 이탈률·리드·가입은 각 기간의 비율로 비교합니다.
            </p>
            {range.to === todayYmd() && <p className="text-xs text-muted-foreground">오늘 통계는 현재까지 수집된 값입니다.</p>}
        </div>
    );
}
