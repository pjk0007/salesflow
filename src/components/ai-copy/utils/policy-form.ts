// 작성 지침 폼의 순수 규칙(UX-243·245). 화면 상태를 바꾸지 않고 다음 값을 계산만 한다.
import { roundTarget, targetsFor, targetsMatchDefaults } from "@/lib/ai-copy/defaults";
import type { CopyPurpose, PerformanceTargets } from "@/lib/ai-copy/types";

export const DEFAULT_MEANINGS: Record<CopyPurpose, string> = {
    visit_ack:
        "갑작스러운 메일에도 방문해 준 것에 대한 감사\n추가로 궁금한 점이 있는지 질문\n전화나 답장으로 문의하면 안내",
    initial_email: "승인된 서비스 사실을 고객 맥락에 맞게 소개\n부담을 줄인 추가 문의 안내",
};
export const DEFAULT_MAX_CHARACTERS: Record<CopyPurpose, number> = {
    visit_ack: 600,
    initial_email: 2000,
};

/** 성능 기준 칸 입력 → 저장 값. 빈 칸·숫자가 아니면 null(기존 값 유지), 소수 오차는 반올림. */
export function targetFromInput(raw: string, scale: number): number | null {
    if (raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? roundTarget(value * scale) : null;
}

/**
 * 사용 목적을 바꿀 때 기본값 그대로인 항목만 새 목적의 기본값으로 바꾼다.
 * 사용자가 고친 의미 목록·성능 기준(변경 사유 포함)은 보존하고, 글자 수는 방문 감사 상한(600)만 맞춘다.
 */
export function switchPurpose(
    form: { meanings: string; maxCharacters: number; targets: PerformanceTargets },
    from: CopyPurpose,
    to: CopyPurpose,
) {
    const untouchedTargets =
        targetsMatchDefaults(form.targets, from) && !form.targets.overrideReason;
    return {
        meanings:
            form.meanings.trim() === "" || form.meanings === DEFAULT_MEANINGS[from]
                ? DEFAULT_MEANINGS[to]
                : form.meanings,
        maxCharacters:
            form.maxCharacters === DEFAULT_MAX_CHARACTERS[from]
                ? DEFAULT_MAX_CHARACTERS[to]
                : Math.min(form.maxCharacters, to === "visit_ack" ? DEFAULT_MAX_CHARACTERS.visit_ack : Infinity),
        targets: untouchedTargets ? targetsFor(to) : form.targets,
    };
}
