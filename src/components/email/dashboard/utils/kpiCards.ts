import type { KpiData, KpiKey } from "../types";
import { countText, rateText, deltaColor, deltaText } from "./format";
import { OPEN_NOTICE_TITLE } from "../../opens/utils/openRate";

export function kpiCards(data: KpiData) {
    const c = data.current;
    const r = data.rates;
    const n = countText;
    const definitions: Array<{
        key: KpiKey;
        label: string;
        sub: string;
        tooltip: string;
        connection?: string;
        count?: boolean;
    }> = [
            {
                key: "sent",
                label: "발송",
                count: true,
                sub: `첫 메일 ${n(c.firstAccepted)}`,
                tooltip: `NHN이 받아 간 메일. 시험·데모·취소 제외. 성공 ${n(c.sent)} · 실패 ${n(c.failed)} · 대기 ${n(c.pending)} · 접수 거절 ${n(c.sendReject)}`
            },
            {
                key: "deliveryRate",
                label: "도달률",
                sub: `반송 ${n(c.bounced)} (하드 ${n(c.bouncedHard)})`,
                tooltip: `배달 확정 ${n(c.delivered)} ÷ 결과 확정 ${n(c.delivered + c.bounced + c.senderSide + c.nhnUnsub)}. 결과 대기 ${n(c.unconfirmed)}통은 빠짐`
            },
            {
                key: "openRate",
                label: "사람 오픈율(추정)",
                sub: `${n(c.opened)}/${n(c.openBase)}`,
                tooltip: `사람 오픈·클릭 ÷ 픽셀을 넣은 성공 발송\n${OPEN_NOTICE_TITLE}`
            },
            {
                key: "clickRate",
                label: "사람 클릭률",
                sub: `CTOR ${rateText(r.ctor)}`,
                tooltip: `사람 클릭 ${n(c.clicked)} ÷ 성공 ${n(c.sent)}. CTOR = 오픈 중 클릭 ${n(c.openedClicked)} ÷ 오픈 ${n(c.opened)}`
            },
            {
                key: "visits",
                label: "메일 유입 방문",
                count: true,
                sub: `행동 ${n(c.siteActions)} · 방문율 ${rateText(r.visitRate)}`,
                tooltip: "사람 클릭으로 사이트 방문이 이어진 발송",
                connection: data.connections.site ? undefined : "사이트 연동 안 됨"
            },
            {
                key: "replyRate",
                label: "회신율",
                sub: `자동응답 ${n(c.autoReplied)}`,
                tooltip: `사람 회신이 온 시퀀스 ${n(c.seqReplied)} ÷ 첫 메일 ${n(c.firstSent)}. 통당 ${n(c.replied)}/${n(c.sent)} (${rateText(r.replyRatePerSend)})`,
                connection: data.connections.reply ? undefined : "회신 연동 안 됨"
            },
            {
                key: "keyLeads",
                label: "핵심 리드",
                count: true,
                sub: `긴급 ${n(data.leads.urgent)} · 주목 ${n(data.leads.highlight)} · 미처리 ${n(data.leads.unhandled)}`,
                tooltip: "판정일 기준 긴급·주목 고객(구글챗과 같은 판정). 아래 목록(최근 30일 최신 판정)과 기준이 다릅니다.",
                connection: data.connections.journey ? undefined : "여정 알림 연동 안 됨"
            },
            {
                key: "unsubscribeRate",
                label: "수신거부율",
                sub: `스팸 신고 ${n(c.complained)}`,
                tooltip: `메일 링크·원클릭 수신거부 ${n(c.unsubscribed)} ÷ 성공 ${n(c.sent)}. 담당자 수동 등록은 빠짐`
            },
        ];
    return definitions.map(item => {
        const lowerIsBetter = item.key === "unsubscribeRate";
        const delta = data.previousCoverage === "full" && !item.connection ? data.kpi[item.key].deltaPct : null;
        return {
            ...item,
            lowerIsBetter,
            value: item.connection ?? (item.count ? countText(data.kpi[item.key].value) : rateText(data.kpi[item.key].value)),
            sub: item.connection ? "" : item.sub,
            delta: deltaText(delta, data.comparison),
            color: deltaColor(delta, lowerIsBetter),
            deltaTooltip: data.previousCoverage === "full" ? "직전 같은 길이 기간 대비" : "비교 기간 집계 준비 중",
        };
    });
}
export type KpiCardModel = ReturnType<typeof kpiCards>[number];
