import type { OperationsReport } from "../types";
import { durationShort } from "./display";

type Stats = OperationsReport["summary"];

/** 응대 성과 지표 — 카드 이름·설명·값·좋은 방향 (상담통계 카드·비교 카드 공통) */
export type Metric = {
    key: string;
    label: string;
    tooltip: string;
    kind: "duration" | "percent" | "count";
    value: (s: Stats) => number | null;
    /** 낮을수록 좋은 지표 (시간·이관율) */
    lowerIsBetter?: boolean;
};

const rate = (n: number, total: number) => (total ? (n / total) * 100 : null);

/** 큰 카드 4개 — 일별 추세와 이전 기간 대비를 같이 본다 */
export const TREND_METRICS: Metric[] = [
    {
        key: "firstReply",
        label: "상담 요청 후 첫 응답까지의 시간",
        tooltip:
            "고객이 문의한 뒤 상담원이나 AI가 처음 답하기까지 걸린 시간의 중앙값이에요.\n업무시간 밖·보류 시간은 빼고 계산해요.\n답을 아직 못 받은 응대는 표본에서 빠져요.",
        kind: "duration",
        value: (s) => s.firstReplyMedianMs,
        lowerIsBetter: true,
    },
    {
        key: "responseAvg",
        label: "평균 응답 시간",
        tooltip:
            "고객 메시지마다 답하기까지 걸린 시간의 평균이에요. 첫 답변과 추가 답변을 모두 포함해요.\n업무시간 밖·보류 시간은 빼고 계산해요.",
        kind: "duration",
        value: (s) => s.responseAvgMs,
        lowerIsBetter: true,
    },
    {
        key: "resolution",
        label: "상담 요청 후 상담 종료까지의 시간",
        tooltip:
            "문의가 시작된 뒤 상담을 종료하기까지 걸린 시간의 중앙값이에요.\n업무시간 밖·보류 시간은 빼고 계산해요.\n아직 진행 중인 응대는 표본에서 빠져요.",
        kind: "duration",
        value: (s) => s.resolutionMedianMs,
        lowerIsBetter: true,
    },
    {
        key: "transfer",
        label: "담당자 이관율",
        tooltip:
            "응대 중에 담당자가 다른 사람으로 바뀐 응대의 비율이에요.\n처음 담당자를 배정한 것은 이관으로 세지 않아요.\n이관 수 ÷ 시작한 응대 수",
        kind: "percent",
        value: (s) => rate(s.transferred, s.started),
        lowerIsBetter: true,
    },
];

/** 작은 카드 — 응대 건수 */
export const COUNT_METRICS: Metric[] = [
    {
        key: "started",
        label: "시작한 응대",
        tooltip: "선택 기간에 새로 시작된 응대 수예요.\n같은 고객이 종료 후 다시 문의하면 새 응대로 따로 세요.",
        kind: "count",
        value: (s) => s.started,
    },
    {
        key: "open",
        label: "진행 중",
        tooltip: "선택 기간에 시작해서 아직 종료하지 않은 응대 수예요. 보류 중인 응대도 포함해요.",
        kind: "count",
        value: (s) => s.open,
    },
    {
        key: "closed",
        label: "종료",
        tooltip: "선택 기간에 시작해서 종료까지 마친 응대 수예요.",
        kind: "count",
        value: (s) => s.closed,
    },
    {
        key: "aiFirst",
        label: "AI 첫 응답",
        tooltip: "첫 답변을 AI가 보낸 응대 수예요.",
        kind: "count",
        value: (s) => s.aiFirst,
    },
];

export function formatMetric(m: Metric, v: number | null) {
    if (v === null) return "—";
    if (m.kind === "duration") return durationShort(v);
    if (m.kind === "percent") return `${Math.round(v * 10) / 10}%`;
    return `${v.toLocaleString("ko-KR")}건`;
}
/** 두 값 차이 글 — "30초", "1.2%p", "3건" */
export function gapText(m: Metric, d: number) {
    if (m.kind === "duration") return durationShort(d);
    if (m.kind === "percent") return `${Math.round(d * 10) / 10}%p`;
    return `${d.toLocaleString("ko-KR")}건`;
}
