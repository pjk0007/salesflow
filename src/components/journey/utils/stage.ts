import type { JourneyEvent } from "../types";

/** 단계 식별 키 — event_name 우선(같은 단계 판별), 없으면 라벨. */
export function stageKey(e: JourneyEvent): string {
    return String(e.meta?.eventName ?? e.label ?? "");
}

/**
 * 단계 묶음 정리 — 이전→다시 다음으로 같은 단계가 반복 발사된 중복을 접는다.
 * 같은 단계(event_name)는 마지막 도달분만 남기고, 표시는 마지막 도달 시각순.
 * → "최종적으로 어느 단계까지 갔나"가 계단으로 보이고 값은 가장 최근 입력분.
 */
export function dedupStages(children: JourneyEvent[]): JourneyEvent[] {
    const lastByKey = new Map<string, JourneyEvent>();
    for (const c of children) {
        const k = stageKey(c);
        const prev = lastByKey.get(k);
        if (!prev || c.at >= prev.at) lastByKey.set(k, c);
    }
    return [...lastByKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}
