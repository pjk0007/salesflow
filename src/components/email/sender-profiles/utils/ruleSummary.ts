/**
 * AI 규칙 목록 카드·규칙 화면 요약 칸에 보이는 짧은 글 (발신 주소 묶음, 후속 발송). 순수 함수만.
 */

interface FollowupStepLike {
    delayDays?: unknown;
}

/**
 * followupConfig를 단계 목록으로. 지금은 배열([{delayDays, …}])로 저장하고, 예전 규칙은 객체 하나다.
 * 발송 쪽(email-followup.ts normalizeFollowupConfig)과 같은 읽기 — 화면이 delayDays를 객체에서만 읽어
 * 배열 규칙에 "후속 일"로 보이던 것을 고친다.
 */
export function followupSteps(config: unknown): FollowupStepLike[] {
    if (!config) return [];
    if (Array.isArray(config)) return config.filter((s): s is FollowupStepLike => !!s && typeof s === "object");
    return typeof config === "object" ? [config as FollowupStepLike] : [];
}

function delayOf(step: FollowupStepLike): number | null {
    return typeof step.delayDays === "number" && Number.isFinite(step.delayDays) ? step.delayDays : null;
}

/** "후속 3일" / "후속 2단계(3·6일)" / 후속이 없으면 null */
export function followupBadgeLabel(config: unknown): string | null {
    const steps = followupSteps(config);
    if (steps.length === 0) return null;
    const days = steps.map(delayOf);
    if (steps.length === 1) return days[0] === null ? "후속 1단계" : `후속 ${days[0]}일`;
    return days.every((d) => d !== null) ? `후속 ${steps.length}단계(${days.join("·")}일)` : `후속 ${steps.length}단계`;
}

export interface PoolProfileLike {
    id: number;
    name: string;
    isDefault: boolean;
}

export type SenderPoolSummary =
    | { kind: "default"; label: string }
    | { kind: "pool"; items: Array<{ id: number; label: string; missing: boolean }> };

/**
 * 규칙의 발신 주소 묶음을 순서대로 이름으로. 비어 있으면 기본 발신 프로필로 보낸다.
 * 목록을 아직 못 읽었으면(loaded=false) 없는 id를 "삭제됨"으로 단정하지 않는다.
 */
export function senderPoolSummary(
    ids: readonly number[],
    profiles: readonly PoolProfileLike[],
    loaded: boolean,
): SenderPoolSummary {
    if (ids.length === 0) {
        const def = profiles.find((p) => p.isDefault);
        return { kind: "default", label: def ? `기본 (${def.name})` : "기본 발신 프로필" };
    }
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return {
        kind: "pool",
        items: ids.map((id) => {
            const p = byId.get(id);
            if (p) return { id, label: p.name, missing: false };
            return { id, label: loaded ? `삭제된 프로필 (#${id})` : `프로필 #${id}`, missing: loaded };
        }),
    };
}
