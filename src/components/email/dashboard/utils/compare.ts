import type { CompareAxis, CompareRow, StatsEnvelope, StatRates } from "../types";
import { countText, rateText } from "./format";
export type SortKey = "label" | "accepted" | "visited" | keyof StatRates;

export function sortRows(rows: CompareRow[], key: SortKey, direction: "asc" | "desc") {
    const value = (row: CompareRow) => key === "label" ? row.label : key === "accepted" || key === "visited" ? row.counts[key] : row.rates[key];
    return [...rows].sort((a, b) => {
        const left = value(a), right = value(b);
        if (left === null)
            return right === null ? 0 : 1;
        if (right === null)
            return -1;
        const diff = typeof left === "string" ? left.localeCompare(String(right), "ko") : left - Number(right);
        return direction === "asc" ? diff : -diff;
    });
}

export function compareColumns(axis: CompareAxis, connections: StatsEnvelope["connections"]) {
    const perSend = axis === "step" || axis === "trigger";
    const columns: Array<{
        key: SortKey;
        label: string;
        tooltip: string;
        disabled?: boolean;
    }> = [
            { key: "label", label: "이름", tooltip: "" },
            { key: "accepted", label: "발송", tooltip: "NHN 접수. 성공·실패·대기·접수 거절" },
            { key: "deliveryRate", label: "도달률", tooltip: "배달 확정 ÷ 결과 확정" },
            { key: "bounceRate", label: "반송률", tooltip: "반송 ÷ 결과 확정" },
        ];
    if (axis === "sender" || axis === "domain")
        columns.push({ key: "senderSideRate", label: "발신 쪽 실패율", tooltip: "발신 쪽 실패 ÷ 결과 확정" });
    columns.push(
        { key: "openRate", label: "오픈율", tooltip: "사람 오픈·클릭 ÷ 오픈 추적 성공 발송" },
        { key: "clickRate", label: "클릭률", tooltip: "사람 클릭 ÷ 성공" },
        { key: "ctor", label: "CTOR", tooltip: "오픈 중 클릭 ÷ 오픈" },
        {
            key: perSend ? "replyRatePerSend" : "replyRate",
            label: `회신율 (${perSend ? "통당" : "첫 메일"})`,
            tooltip: connections.reply ? "사람 회신 ÷ 발송 기준" : "연동 안 됨",
            disabled: !connections.reply
        },
        { key: "unsubscribeRate", label: "수신거부율", tooltip: "메일 링크·원클릭 수신거부 ÷ 성공" },
        {
            key: "visited",
            label: "방문",
            tooltip: connections.site ? "메일 유입 방문 발송 수" : "연동 안 됨",
            disabled: !connections.site
        }
    );
    return columns;
}

export function compareRowModel(row: CompareRow, columns: ReturnType<typeof compareColumns>) {
    const c = row.counts;
    return {
        ...row,
        cells: columns.slice(1).map(column => ({
            key: column.key,
            text: column.disabled ? "—" : column.key === "accepted" || column.key === "visited" ? countText(c[column.key]) : rateText(row.rates[column.key as keyof StatRates]),
            tooltip: `성공 ${c.sent} · 실패 ${c.failed} · 대기 ${c.pending} · 접수 거절 ${c.sendReject}` +
                `\n확정 ${c.delivered + c.bounced + c.senderSide + c.nhnUnsub} · 하드 ${c.bouncedHard}` +
                `\n오픈 ${c.opened}/${c.openBase} · 클릭 ${c.clicked}/${c.sent} · CTOR ${c.openedClicked}/${c.opened}` +
                `\n자동응답 ${c.autoReplied} · 스팸 신고 ${c.complained} · 행동 ${c.siteActions}`,
        }))
    };
}
export const AXIS_OPTIONS: Array<{
    value: CompareAxis;
    label: string;
}> = [
        { value: "campaign", label: "캠페인" }, { value: "step", label: "후속 단계" }, { value: "partition", label: "명단" },
        { value: "sender", label: "발신 주소" }, { value: "domain", label: "발신 도메인" }, { value: "trigger", label: "발송 유형" }, { value: "date", label: "날짜" },
    ];
