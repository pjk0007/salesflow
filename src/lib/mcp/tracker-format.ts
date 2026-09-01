/**
 * MCP 트래커 툴의 순수 변환. DB를 모른다.
 *
 * 전환율·이탈을 서버에서 계산해 넣는 이유: Claude가 숫자를 직접 나누게 두면
 * 산술 실수가 사용자에게 그대로 전달된다.
 */

export interface FunnelStageInput {
    key: string;
    label: string;
    visitors: number;
    isAuto?: boolean;
}

export interface FunnelStageMetrics extends FunnelStageInput {
    /** 직전 단계 대비 %. 첫 단계는 이전이 없으므로 null (0이 아니다). */
    conversionRate: number | null;
    /** 직전 단계에서 떨어진 절대 수. 첫 단계는 null. */
    dropOff: number | null;
    dropOffRate: number | null;
}

export interface FunnelMetrics {
    stages: FunnelStageMetrics[];
    /** 마지막 / 첫 단계. 첫 단계가 0이면 null. */
    overallConversionRate: number | null;
    /** 가장 많이 빠진 구간. 단계가 2개 미만이면 null. */
    biggestDropOff: {
        fromKey: string;
        toKey: string;
        dropOff: number;
        dropOffRate: number | null;
    } | null;
}

function round1(value: number): number {
    return Number(value.toFixed(1));
}

/** 0으로 나누지 않는 비율. 분모가 0이면 null — Infinity가 JSON에 실리면 조용히 null이 된다. */
function rate(numerator: number, denominator: number): number | null {
    if (denominator === 0) return null;
    return round1((numerator / denominator) * 100);
}

export function computeFunnelMetrics(input: readonly FunnelStageInput[]): FunnelMetrics {
    const stages: FunnelStageMetrics[] = input.map((stage, i) => {
        if (i === 0) {
            return { ...stage, conversionRate: null, dropOff: null, dropOffRate: null };
        }
        const prev = input[i - 1].visitors;
        // event 퍼널은 cumulative 역산을 하지 않아 뒤 단계가 앞보다 클 수 있다 — 음수 이탈을 만들지 않는다
        const dropOff = Math.max(0, prev - stage.visitors);
        return {
            ...stage,
            conversionRate: rate(stage.visitors, prev),
            dropOff,
            dropOffRate: rate(dropOff, prev),
        };
    });

    const first = input[0]?.visitors ?? 0;
    const last = input[input.length - 1]?.visitors ?? 0;
    const overallConversionRate = input.length === 0 ? null : rate(last, first);

    let biggestDropOff: FunnelMetrics["biggestDropOff"] = null;
    for (let i = 1; i < stages.length; i++) {
        const dropOff = stages[i].dropOff ?? 0;
        // 동률이면 앞선 구간을 유지한다 (> 로 비교)
        if (biggestDropOff === null || dropOff > biggestDropOff.dropOff) {
            biggestDropOff = {
                fromKey: input[i - 1].key,
                toKey: input[i].key,
                dropOff,
                dropOffRate: stages[i].dropOffRate,
            };
        }
    }

    return { stages, overallConversionRate, biggestDropOff };
}

/** 페이지 크기를 기본값·상한 안으로 넣는다. MCP 응답이 Claude 컨텍스트를 잡아먹지 않게. */
export function clampPageSize(value: number | undefined, fallback: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(Math.floor(value), max);
}
