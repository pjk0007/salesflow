import type { CompareAxis } from "@/components/email/dashboard/types";
import { isValidYmd } from "../tracker/date-range";
import { kstToday } from "./rules";
type StatsView = "kpi" | "trend" | "compare";
export type StatsQueryResult = {
    ok: true;
    view: StatsView;
    from: string;
    to: string;
    days: number;
    workspaceId: number | null;
    axis: CompareAxis;
} | {
    ok: false;
    error: string;
};
const AXES: readonly string[] = ["campaign", "step", "partition", "sender", "domain", "trigger", "date"];
/** 형식만 검증한다. workspaceId의 조직 소속 검증은 호출하는 라우트 책임이다. */
export function parseStatsQuery(sp: URLSearchParams, now: Date): StatsQueryResult {
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (!isValidYmd(from) || !isValidYmd(to) || from > to)
        return { ok: false, error: "조회 기간의 시작일과 종료일을 확인해 주세요." };
    if (to > kstToday(now))
        return { ok: false, error: "오늘 이후 날짜는 볼 수 없습니다." };
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days > 366)
        return { ok: false, error: "조회 기간은 366일까지입니다." };
    const view = sp.get("view");
    if (view !== "kpi" && view !== "trend" && view !== "compare")
        return { ok: false, error: "보기 종류를 확인해 주세요." };
    const axis = sp.get("axis") ?? "campaign";
    if (!AXES.includes(axis))
        return { ok: false, error: "비교 축을 확인해 주세요." };
    const workspace = sp.get("workspaceId");
    const workspaceId = workspace === null || workspace === "" ? null : Number(workspace);
    if (workspaceId !== null && (!/^\d+$/.test(workspace!) || !Number.isSafeInteger(workspaceId) || workspaceId <= 0))
        return { ok: false, error: "워크스페이스를 확인해 주세요." };
    return { ok: true, view, from, to, days, workspaceId, axis: axis as CompareAxis };
}
