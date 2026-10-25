import type { ExperimentState } from "./types";

/**
 * 실험 상태의 한국어 이름. 화면 배지와 서버의 판단 보류 사유(rules.ts blocks)·채택 오류가 함께 쓴다 (UX-158).
 * 의존성이 없어 클라이언트 화면도 가져다 쓸 수 있다.
 */
export const EXPERIMENT_STATE_LABELS: Record<ExperimentState, string> = {
    draft: "초안",
    evaluated: "사전 점검 완료",
    running: "모집 중",
    enrollment_closed: "모집 종료",
    observing: "관찰 중",
    decision_ready: "판단 검토",
    closed: "종료",
    paused: "일시 중지",
    data_check: "데이터 확인",
    insufficient_sample: "표본 부족",
    invalidated: "무효화",
};

export const experimentStateLabel = (state: string) => EXPERIMENT_STATE_LABELS[state as ExperimentState] ?? state;
