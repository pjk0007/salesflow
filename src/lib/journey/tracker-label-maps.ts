/**
 * 트래커 이벤트 라벨 맵 만들기 (순수 함수). DB를 모른다.
 *
 * 여정 화면(loadTrackerLabelMaps)과 깊이 들어온 사람 알림 카드(deep-visitor-alert)가 같은 규칙을 쓴다 —
 * 알림은 사이트 설정을 다른 조회와 한 번에 읽으므로 읽은 줄을 여기에 넘긴다.
 */
import type { FunnelStage } from "@/components/tracker/types/funnel";

export type TrackerLabelMaps = {
    /** 퍼널 단계로 등록된 CUSTOM 이벤트 이름 — [단계 전환] 행으로 분리 표시 */
    funnelStageEventNames: Set<string>;
    /** event_name → 한글 라벨 (퍼널 단계 라벨 우선, 이벤트 별칭 보완) */
    customEventLabels: Map<string, string>;
};

/**
 * 퍼널 단계·CUSTOM 이벤트 별칭에서 라벨 맵을 만든다.
 * ① 퍼널 단계 라벨(FunnelEditor) 우선, ② 이벤트 별칭 카드 보완 — 별칭을 먼저 넣고 퍼널 라벨이 덮어쓴다.
 * 같은 이름이 여러 번 나오면 뒤의 것이 이긴다 (넘긴 순서대로 본다).
 */
export function buildTrackerLabelMaps(
    funnels: ReadonlyArray<{ stages: ReadonlyArray<FunnelStage> | null | undefined }>,
    customAliases: ReadonlyArray<{ eventName: string; label: string | null }>,
): TrackerLabelMaps {
    const funnelStageEventNames = new Set<string>();
    const customEventLabels = new Map<string, string>();
    // ② 라벨 카드 먼저 (퍼널 라벨이 덮어쓰도록)
    for (const a of customAliases) {
        if (a.label?.trim()) customEventLabels.set(a.eventName, a.label);
    }
    // ① 퍼널 단계 라벨 우선 적용
    for (const f of funnels) {
        for (const st of (f.stages ?? [])) {
            if (st.match?.type === "custom_event") {
                funnelStageEventNames.add(st.match.eventName);
                if (st.label?.trim()) customEventLabels.set(st.match.eventName, st.label);
            }
        }
    }
    return { funnelStageEventNames, customEventLabels };
}
