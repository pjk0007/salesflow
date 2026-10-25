import type { StatsEnvelope } from "../types";

/** 집계 기준 시각 문구 — 이메일 통계 화면과 홈 발송 분석이 같이 쓴다 */
export function freshnessText(asOf: string | null, now: Date) {
    const time = asOf ? new Date(asOf).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
    const isStale = asOf !== null && now.getTime() - new Date(asOf).getTime() > 30 * 60000;
    return {
        isStale,
        text: time ? (isStale ? `집계가 멈춰 있습니다(마지막 ${time})` : `집계 기준 ${time}`) : "집계 준비 중입니다. 반영 직후 몇 분 안에 최근 날짜부터 채워집니다.",
    };
}

export function freshness(data: StatsEnvelope, now: Date) {
    return {
        ...freshnessText(data.asOf, now),
        coverage: !data.coverage ? "" : data.coverage.from === null ? "전체 기간 집계됨" : `${data.coverage.from} ~ ${data.coverage.to} 집계됨`,
        notice: data.coverage?.from && data.range.from < data.coverage.from ? `${data.coverage.from} 이전 날짜는 집계 준비 중입니다. 그 날짜의 숫자는 빠져 있습니다.` : "",
    };
}
