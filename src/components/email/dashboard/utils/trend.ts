import type { TrendData } from "../types";

export function trendModel(data: TrendData) {
    const bands: Array<{
        from: string;
        to: string;
        label: string;
    }> = [];
    for (const [flag, label] of [["ready", "집계 준비 중"], ["maturing", "반응이 쌓이는 중"]] as const) {
        let band: typeof bands[number] | undefined;
        for (const point of data.points) {
            if (flag === "ready" ? !point.ready : point.maturing) {
                if (band)
                    band.to = point.date;
                else {
                    band = { from: point.date, to: point.date, label };
                    bands.push(band);
                }
            }
            else
                band = undefined;
        }
    }
    return {
        bands,
        points: data.points.map(point => ({
            date: point.date,
            accepted: point.counts.accepted,
            openRate: point.ready ? point.rates.openRate : null,
            clickRate: point.ready ? point.rates.clickRate : null,
            replyRate: point.ready && data.connections.reply ? point.rates.replyRate : null,
            bounceRate: point.ready ? point.rates.bounceRate : null,
            unsubscribeRate: point.ready ? point.rates.unsubscribeRate : null,
        }))
    };
}
