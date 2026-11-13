import { compareCard } from "@/components/leadgen/utils/groups";
import { useLeadStats } from "./useLeadStats";
import type { Period } from "./usePeriodCompare";

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const hours = (v: number | null) => (v === null ? "-" : v < 1 ? `${Math.round(v * 60)}분` : v < 48 ? `${v.toFixed(1)}시간` : `${(v / 24).toFixed(1)}일`);
const days = (v: number | null) => (v === null ? "-" : v < 1 ? "1일 미만" : `${v.toFixed(1)}일`);

/** 리드통계 기간 비교 (A·B·C) — 훅 개수를 고정하려고 세 자리를 늘 부른다 (빈 자리는 요청 안 함) */
export function useLeadStatsCompare(workspaceId: number | null, periods: Period[]) {
    const slot = (i: number) => (periods[i] ? workspaceId : null);
    const a = useLeadStats(slot(0), periods[0] ?? {});
    const b = useLeadStats(slot(1), periods[1] ?? {});
    const c = useLeadStats(slot(2), periods[2] ?? {});
    const all = [a, b, c].slice(0, periods.length);
    const list = all.every((x) => x.stats) ? all.map((x) => x.stats!) : null;
    const groups = periods.map((_, i) => i);
    const cards = list
        ? [
              compareCard({
                  key: "leads",
                  label: "유입",
                  groups,
                  values: list.map((s) => s.totals.leads),
                  format: (v) => `${v ?? 0}건`,
                  gap: (d) => `${d}건`,
                  word: "많아요",
              }),
              compareCard({
                  key: "converted",
                  label: "전환",
                  groups,
                  values: list.map((s) => s.totals.converted),
                  format: (v) => `${v ?? 0}건`,
                  gap: (d) => `${d}건`,
                  word: "많아요",
              }),
              compareCard({
                  key: "conversionRate",
                  label: "전환율",
                  groups,
                  values: list.map((s) => s.totals.conversionRate),
                  format: pct,
                  gap: (d) => `${(d * 100).toFixed(1)}%p`,
                  word: "높아요",
              }),
              compareCard({
                  key: "within30d",
                  label: "30일 안 전환율",
                  tooltip: "들어온 지 30일이 지난 리드 중 30일 안에 전환된 비율이에요.\n최근 기간은 아직 전환될 시간이 부족해서, 기간끼리 공정하게 비교하려면 이 값을 보세요.",
                  groups,
                  values: list.map((s) => (s.within30d.eligible ? s.within30d.converted / s.within30d.eligible : null)),
                  format: pct,
                  gap: (d) => `${(d * 100).toFixed(1)}%p`,
                  word: "높아요",
              }),
              compareCard({
                  key: "conversionDays",
                  label: "전환까지 걸린 기간",
                  tooltip: "전환된 리드의 중앙값이에요.",
                  groups,
                  values: list.map((s) => s.conversion.medianDays),
                  format: days,
                  gap: (d) => `${d.toFixed(1)}일`,
                  lowerIsBetter: true,
                  word: "짧아요",
              }),
              compareCard({
                  key: "firstResponse",
                  label: "첫 응답까지",
                  tooltip: "첫 댓글까지 걸린 시간의 중앙값이에요.",
                  groups,
                  values: list.map((s) => s.response.medianFirstResponseHours),
                  format: hours,
                  gap: hours,
                  lowerIsBetter: true,
                  word: "빨라요",
              }),
              compareCard({
                  key: "within24h",
                  label: "24시간 안 응답",
                  groups,
                  values: list.map((s) => (s.totals.leads ? s.response.respondedWithin24h / s.totals.leads : null)),
                  format: pct,
                  gap: (d) => `${(d * 100).toFixed(1)}%p`,
                  word: "높아요",
              }),
          ]
        : [];
    // 연락 유형별 횟수 — 기간마다 같은 유형끼리 (A에서 많은 순, 다른 기간에만 있는 유형은 뒤에)
    const kinds = list
        ? [...new Set(list.flatMap((st) => st.memoKinds.map((k) => k.kind)))].map((kind) => ({
              kind,
              values: list.map((st) => st.memoKinds.find((k) => k.kind === kind)?.count ?? 0),
          }))
        : [];
    return {
        cards,
        kinds,
        isLoading: all.some((x) => x.isLoading) || !list,
        error: all.find((x) => x.error)?.error,
    };
}
